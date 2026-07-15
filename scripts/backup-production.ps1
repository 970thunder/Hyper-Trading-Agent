[CmdletBinding()]
param(
    [string]$EnvFile = ".env.production",
    [string]$BackupDirectory = "backups",
    [string]$ProjectName = "hyper-trading-agent"
)

$ErrorActionPreference = "Stop"

function Invoke-Compose {
    param([Parameter(Mandatory = $true)][string[]]$ComposeArgs)
    & docker compose --env-file $EnvFile -f docker-compose.prod.yml @ComposeArgs
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose failed: $($ComposeArgs -join ' ')"
    }
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "Production environment file not found: $EnvFile"
}

$backupPath = [System.IO.Path]::GetFullPath($BackupDirectory)
New-Item -ItemType Directory -Force -Path $backupPath | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$postgresDump = Join-Path $backupPath "postgres-$stamp.sql"

Write-Host "Backing up PostgreSQL to $postgresDump"
Invoke-Compose -ComposeArgs @("exec", "-T", "postgres", "pg_dump", "-U", "vibe", "vibe_trading") |
    Set-Content -Encoding utf8 -Path $postgresDump
if (-not (Test-Path -LiteralPath $postgresDump) -or (Get-Item -LiteralPath $postgresDump).Length -eq 0) {
    throw "PostgreSQL backup is empty"
}

$volumes = @("vibe-home", "vibe-uploads", "vibe-runs", "vibe-sessions")
$objectStorageVolume = "${ProjectName}_vibe-object-storage"
& docker volume inspect $objectStorageVolume *> $null
if ($LASTEXITCODE -eq 0) {
    $volumes += "vibe-object-storage"
}
$archives = @()
foreach ($volume in $volumes) {
    $archiveName = "$volume-$stamp.tgz"
    Write-Host "Backing up $volume"
    & docker run --rm `
        -v "${ProjectName}_${volume}:/source:ro" `
        -v "${backupPath}:/backup" `
        alpine:3.20 tar czf "/backup/$archiveName" -C /source .
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to back up volume: $volume"
    }
    $archivePath = Join-Path $backupPath $archiveName
    if (-not (Test-Path -LiteralPath $archivePath)) {
        throw "Volume archive was not created: $archivePath"
    }
    $archives += Get-Item -LiteralPath $archivePath
}

$postgresDumpItem = Get-Item -LiteralPath $postgresDump
$manifest = [ordered]@{
    schema_version = 2
    created_at = (Get-Date).ToUniversalTime().ToString("o")
    project_name = $ProjectName
    postgres_dump = [ordered]@{
        file = $postgresDumpItem.Name
        bytes = $postgresDumpItem.Length
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $postgresDumpItem.FullName).Hash.ToLowerInvariant()
    }
    volumes = @($archives | ForEach-Object {
        [ordered]@{
            archive = $_.Name
            bytes = $_.Length
            sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
        }
    })
}
$manifestPath = Join-Path $backupPath "manifest-$stamp.json"
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 -Path $manifestPath

Write-Host "Backup complete: $manifestPath"
