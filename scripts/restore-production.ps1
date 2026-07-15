[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$BackupDirectory,
    [Parameter(Mandatory = $true)][string]$Timestamp,
    [string]$EnvFile = ".env.production",
    [string]$ProjectName = "hyper-trading-agent",
    [switch]$ConfirmRestore
)

$ErrorActionPreference = "Stop"

function Invoke-Compose {
    param([Parameter(Mandatory = $true)][string[]]$ComposeArgs)
    & docker compose --env-file $EnvFile -f docker-compose.prod.yml @ComposeArgs
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose failed: $($ComposeArgs -join ' ')"
    }
}

if (-not $ConfirmRestore) {
    throw "Restoration overwrites PostgreSQL and named volumes. Re-run with -ConfirmRestore after validating the backup in staging."
}
if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "Production environment file not found: $EnvFile"
}

$backupPath = [System.IO.Path]::GetFullPath($BackupDirectory)
$manifestPath = Join-Path $backupPath "manifest-$Timestamp.json"
if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "Backup manifest is missing for timestamp: $Timestamp"
}
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ([int]$manifest.schema_version -lt 2 -or $manifest.postgres_dump -is [string]) {
    throw "Backup manifest is too old to verify the PostgreSQL dump. Create a new backup before restoring."
}
$postgresDump = Join-Path $backupPath $manifest.postgres_dump.file
if (-not (Test-Path -LiteralPath $postgresDump)) {
    throw "PostgreSQL dump is missing for timestamp: $Timestamp"
}
$postgresHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $postgresDump).Hash.ToLowerInvariant()
if ($postgresHash -ne $manifest.postgres_dump.sha256) {
    throw "Checksum mismatch: $postgresDump"
}
foreach ($volume in $manifest.volumes) {
    $archivePath = Join-Path $backupPath $volume.archive
    if (-not (Test-Path -LiteralPath $archivePath)) {
        throw "Missing volume archive: $archivePath"
    }
    $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
    if ($actualHash -ne $volume.sha256) {
        throw "Checksum mismatch: $archivePath"
    }
}

Write-Host "Stopping application services"
Invoke-Compose -ComposeArgs @("stop", "api", "worker")

Write-Host "Restoring PostgreSQL"
Invoke-Compose -ComposeArgs @("exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "vibe", "-d", "vibe_trading", "-c", "DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
Get-Content -Raw -LiteralPath $postgresDump | & docker compose --env-file $EnvFile -f docker-compose.prod.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U vibe -d vibe_trading
if ($LASTEXITCODE -ne 0) {
    throw "Failed to restore PostgreSQL dump"
}

foreach ($volume in $manifest.volumes) {
    $volumeName = [System.IO.Path]::GetFileNameWithoutExtension([System.IO.Path]::GetFileNameWithoutExtension($volume.archive)) -replace "-$Timestamp$", ""
    $archiveName = $volume.archive
    Write-Host "Restoring $volumeName"
    & docker run --rm `
        -v "${ProjectName}_${volumeName}:/target" `
        -v "${backupPath}:/backup:ro" `
        alpine:3.20 sh -ec "rm -rf /target/* && tar xzf /backup/$archiveName -C /target"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to restore volume: $volumeName"
    }
}

Write-Host "Starting production services"
Invoke-Compose -ComposeArgs @("up", "-d")
Write-Host "Restore completed. Verify the health endpoint, Owner login, RAG retrieval, and historical workspace data."
