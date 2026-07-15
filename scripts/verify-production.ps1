[CmdletBinding()]
param(
    [string]$EnvFile = ".env.production",
    [string]$ApiBaseUrl = "http://127.0.0.1:8899",
    [switch]$AllowLocalDev
)

$ErrorActionPreference = "Stop"

function Invoke-Compose {
    param([Parameter(Mandatory = $true)][string[]]$ComposeArgs)
    & docker compose --env-file $EnvFile -f docker-compose.prod.yml @ComposeArgs
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose failed: $($ComposeArgs -join ' ')"
    }
}

function Read-EnvironmentFile {
    param([string]$Path)
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
            $value = $matches[2]
            if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            $values[$matches[1]] = $value
        }
    }
    return $values
}

function Assert-ProductionConfiguration {
    param([hashtable]$Values)
    if ($AllowLocalDev) {
        Write-Host "Skipping public-server environment checks because -AllowLocalDev was supplied"
        return
    }

    $requiredSecrets = @("POSTGRES_PASSWORD", "API_AUTH_KEY", "VIBE_TRADING_SECRET_KEY")
    foreach ($key in $requiredSecrets) {
        $value = [string]$Values[$key]
        if ([string]::IsNullOrWhiteSpace($value) -or $value -match '(?i)change-me|replace-with|example|secret$') {
            throw "Production environment has an unset or placeholder $key"
        }
    }
    $apiBind = [string]$Values["API_BIND"]
    if ([string]::IsNullOrWhiteSpace($apiBind)) { $apiBind = "127.0.0.1" }
    if ($apiBind -notin @("127.0.0.1", "localhost", "::1")) {
        throw "API_BIND must remain loopback-only when the Nginx gateway is the public entry point"
    }
    if ([string]$Values["VIBE_TRADING_COOKIE_SECURE"] -notmatch '^(true|1|yes|on)$') {
        throw "VIBE_TRADING_COOKIE_SECURE must be true for server deployment"
    }
    if ([string]$Values["VIBE_TRADING_TRUST_DOCKER_LOOPBACK"] -match '^(true|1|yes|on)$') {
        throw "VIBE_TRADING_TRUST_DOCKER_LOOPBACK must be disabled for server deployment"
    }
    $corsOrigins = [string]$Values["CORS_ORIGINS"]
    if ([string]::IsNullOrWhiteSpace($corsOrigins) -or $corsOrigins -match '(?i)\*|http://') {
        throw "CORS_ORIGINS must contain explicit HTTPS application origins"
    }
    if ([string]::IsNullOrWhiteSpace([string]$Values["HYPER_TRADING_PLATFORM_ADMIN_EMAILS"])) {
        throw "HYPER_TRADING_PLATFORM_ADMIN_EMAILS must name at least one bootstrap system administrator"
    }
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "Production environment file not found: $EnvFile"
}

Write-Host "Checking deployment environment policy"
Assert-ProductionConfiguration -Values (Read-EnvironmentFile -Path $EnvFile)

Write-Host "Checking Docker service state"
Invoke-Compose -ComposeArgs @("ps")

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
$vectorStatus = Invoke-Compose -ComposeArgs @("exec", "-T", "api", "python", "-c", "from src.commercial.vector_store import build_vector_store_adapter; import json; print(json.dumps(build_vector_store_adapter().status()))")
$vectorJson = ($vectorStatus | Select-Object -Last 1) | ConvertFrom-Json
if ($vectorJson.active -ne "postgres-pgvector" -or -not $vectorJson.available) {
    throw "pgvector runtime is not available: $($vectorJson | ConvertTo-Json -Compress)"
}

Write-Host "Checking PostgreSQL migration table"
Invoke-Compose -ComposeArgs @("exec", "-T", "postgres", "psql", "-U", "vibe", "-d", "vibe_trading", "-tAc", "SELECT to_regclass('public.rag_vector_chunks')") | ForEach-Object {
    if ($_.Trim() -ne "rag_vector_chunks") { throw "rag_vector_chunks migration is missing" }
}

Write-Host "Checking migration ledger"
$migrationCount = Invoke-Compose -ComposeArgs @("exec", "-T", "postgres", "psql", "-U", "vibe", "-d", "vibe_trading", "-tAc", "SELECT COUNT(*) FROM schema_migrations")
if ([int](($migrationCount | Select-Object -Last 1).Trim()) -lt 1) {
    throw "schema_migrations has no applied migration records"
}

Write-Host "Checking PostgreSQL-primary commercial repositories"
$repositoryStatus = Invoke-Compose -ComposeArgs @("exec", "-T", "api", "python", "-c", "from src.commercial.store import CommercialStore; import json; print(json.dumps(CommercialStore().platform_database_status()))")
$repositoryJson = ($repositoryStatus | Select-Object -Last 1) | ConvertFrom-Json
if ($repositoryJson.engine -ne "postgresql" -or $repositoryJson.identity_storage -ne "postgres-primary" -or $repositoryJson.governance_storage -ne "postgres-primary" -or $repositoryJson.knowledge_storage -ne "postgres-primary" -or $repositoryJson.workspace_storage -ne "postgres-primary") {
    throw "Commercial repository status is not PostgreSQL-primary: $($repositoryJson | ConvertTo-Json -Compress)"
}

Write-Host "Production readiness checks passed"
