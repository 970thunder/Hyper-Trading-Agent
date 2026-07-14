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
$health = Invoke-RestMethod -Uri "$ApiBaseUrl/health" -TimeoutSec 15
if ($health.status -ne "healthy") {
    throw "Health endpoint returned an unexpected status: $($health.status)"
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

Write-Host "Production readiness checks passed"
