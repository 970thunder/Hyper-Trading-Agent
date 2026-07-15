[CmdletBinding()]
param(
    [string]$EnvFile = ".env.production",
    [string]$ApiBaseUrl = "http://127.0.0.1:8899"
)

$ErrorActionPreference = "Stop"

function Invoke-Compose {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    & docker compose --env-file $EnvFile -f docker-compose.prod.yml @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose failed: $($Arguments -join ' ')"
    }
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "Production environment file not found: $EnvFile"
}

Write-Host "Checking Docker service state"
Invoke-Compose ps

Write-Host "Checking API health"
$health = $null
$lastHealthError = ""
for ($attempt = 1; $attempt -le 30; $attempt++) {
    try {
        $health = Invoke-RestMethod -Uri "$ApiBaseUrl/health" -TimeoutSec 5
        if ($health.status -eq "healthy") {
            break
        }
        $lastHealthError = "unexpected status: $($health.status)"
    } catch {
        $lastHealthError = $_.Exception.Message
    }
    Start-Sleep -Seconds 2
}
if ($null -eq $health -or $health.status -ne "healthy") {
    throw "Health endpoint did not become ready: $lastHealthError"
}

Write-Host "Checking anonymous workspace access is denied"
try {
    Invoke-WebRequest -Uri "$ApiBaseUrl/sessions" -UseBasicParsing -TimeoutSec 15 | Out-Null
    throw "Anonymous /sessions request unexpectedly succeeded"
} catch {
    $statusCode = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    if ($statusCode -ne 401) {
        throw
    }
}

Write-Host "Checking pgvector runtime adapter"
$vectorStatus = Invoke-Compose exec -T api python -c "from src.commercial.vector_store import build_vector_store_adapter; import json; print(json.dumps(build_vector_store_adapter().status()))"
$vectorJson = ($vectorStatus | Select-Object -Last 1) | ConvertFrom-Json
if ($vectorJson.active -ne "postgres-pgvector" -or -not $vectorJson.available) {
    throw "pgvector runtime is not available: $($vectorJson | ConvertTo-Json -Compress)"
}

Write-Host "Checking PostgreSQL migration table"
Invoke-Compose exec -T postgres psql -U vibe -d vibe_trading -tAc "SELECT to_regclass('public.rag_vector_chunks')" | ForEach-Object {
    if ($_.Trim() -ne "rag_vector_chunks") { throw "rag_vector_chunks migration is missing" }
}

Write-Host "Checking migration ledger"
$migrationCount = Invoke-Compose exec -T postgres psql -U vibe -d vibe_trading -tAc "SELECT COUNT(*) FROM schema_migrations"
if ([int](($migrationCount | Select-Object -Last 1).Trim()) -lt 1) {
    throw "schema_migrations has no applied migration records"
}

Write-Host "Checking PostgreSQL-primary commercial repositories"
$repositoryStatus = Invoke-Compose exec -T api python -c "from src.commercial.store import CommercialStore; import json; print(json.dumps(CommercialStore().platform_database_status()))"
$repositoryJson = ($repositoryStatus | Select-Object -Last 1) | ConvertFrom-Json
if ($repositoryJson.engine -ne "postgresql" -or $repositoryJson.identity_storage -ne "postgres-primary" -or $repositoryJson.governance_storage -ne "postgres-primary" -or $repositoryJson.knowledge_storage -ne "postgres-primary" -or $repositoryJson.workspace_storage -ne "postgres-primary") {
    throw "Commercial repository status is not PostgreSQL-primary: $($repositoryJson | ConvertTo-Json -Compress)"
}

Write-Host "Production readiness checks passed"
