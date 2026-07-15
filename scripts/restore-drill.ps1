[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$BackupDirectory,
    [Parameter(Mandatory = $true)][string]$Timestamp,
    [string]$EnvFile = ".env.production",
    [string]$SourceProjectName = "hyper-trading-agent",
    [string]$StagingProjectName = "hyper-trading-agent-restore-drill",
    [switch]$KeepStaging
)

$ErrorActionPreference = "Stop"

function Invoke-Docker {
    param([Parameter(Mandatory = $true)][string[]]$DockerArgs)
    $previousErrorAction = $ErrorActionPreference
    try {
        # Docker Compose writes normal progress messages to stderr. Treat only
        # its process exit code as failure so strict PowerShell mode is safe.
        $ErrorActionPreference = "Continue"
        & docker @DockerArgs
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }
    if ($exitCode -ne 0) {
        throw "docker command failed ($exitCode): $($DockerArgs -join ' ')"
    }
}

function Invoke-StagingCompose {
    param([Parameter(Mandatory = $true)][string[]]$ComposeArgs)
    $dockerArgs = @("compose", "--project-name", $StagingProjectName, "--env-file", $EnvFile, "-f", "docker-compose.prod.yml") + $ComposeArgs
    Invoke-Docker -DockerArgs $dockerArgs
}

function Assert-ArchiveChecksum {
    param([object]$Archive, [string]$Root)
    $path = Join-Path $Root $Archive.archive
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Missing volume archive: $path"
    }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
    if ($actual -ne $Archive.sha256) {
        throw "Checksum mismatch: $path"
    }
}

if ($StagingProjectName -eq $SourceProjectName) {
    throw "StagingProjectName must be different from the production project name"
}
if ($StagingProjectName -notmatch '^[a-z0-9][a-z0-9_-]*$') {
    throw "StagingProjectName must contain only lowercase letters, numbers, underscores, and hyphens"
}
if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "Environment file not found: $EnvFile"
}

$backupPath = [System.IO.Path]::GetFullPath($BackupDirectory)
$manifestPath = Join-Path $backupPath "manifest-$Timestamp.json"
if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "Backup manifest is missing for timestamp: $Timestamp"
}
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ([int]$manifest.schema_version -lt 2 -or $manifest.postgres_dump -is [string]) {
    throw "Backup manifest is too old to validate. Create a new schema version 2 backup first."
}
$postgresDump = Join-Path $backupPath $manifest.postgres_dump.file
if (-not (Test-Path -LiteralPath $postgresDump)) {
    throw "PostgreSQL dump is missing: $postgresDump"
}
$postgresHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $postgresDump).Hash.ToLowerInvariant()
if ($postgresHash -ne $manifest.postgres_dump.sha256) {
    throw "Checksum mismatch: $postgresDump"
}
foreach ($volume in $manifest.volumes) {
    Assert-ArchiveChecksum -Archive $volume -Root $backupPath
}

$stagingVolumes = @("vibe-postgres", "vibe-home", "vibe-uploads", "vibe-runs", "vibe-sessions", "vibe-object-storage") |
    ForEach-Object { "${StagingProjectName}_$_" }

try {
    Write-Host "Starting isolated PostgreSQL restore target: $StagingProjectName"
    Invoke-StagingCompose -ComposeArgs @("up", "-d", "postgres")

    $ready = $false
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        try {
            Invoke-StagingCompose -ComposeArgs @("exec", "-T", "postgres", "pg_isready", "-U", "vibe", "-d", "vibe_trading") | Out-Null
            $ready = $true
            break
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    if (-not $ready) {
        throw "Staging PostgreSQL did not become ready"
    }

    Write-Host "Restoring PostgreSQL dump into isolated staging database"
    Invoke-StagingCompose -ComposeArgs @("exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "vibe", "-d", "vibe_trading", "-c", "DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    $previousErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $postgresContainer = (& docker compose --project-name $StagingProjectName --env-file $EnvFile -f docker-compose.prod.yml ps -q postgres).Trim()
        $postgresContainerExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }
    if ($postgresContainerExitCode -ne 0) {
        throw "Could not resolve the isolated PostgreSQL container"
    }
    if ([string]::IsNullOrWhiteSpace($postgresContainer)) {
        throw "Could not resolve the isolated PostgreSQL container"
    }
    Invoke-Docker -DockerArgs @("cp", $postgresDump, "${postgresContainer}:/tmp/restore.sql")
    Invoke-StagingCompose -ComposeArgs @("exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "vibe", "-d", "vibe_trading", "-f", "/tmp/restore.sql")
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to restore PostgreSQL dump into staging"
    }

    foreach ($volume in $manifest.volumes) {
        $volumeName = [System.IO.Path]::GetFileNameWithoutExtension([System.IO.Path]::GetFileNameWithoutExtension($volume.archive)) -replace "-$Timestamp$", ""
        $targetVolume = "${StagingProjectName}_${volumeName}"
        Invoke-Docker -DockerArgs @("volume", "create", $targetVolume) | Out-Null
        Write-Host "Restoring $volumeName into staging volume"
        Invoke-Docker -DockerArgs @(
            "run", "--rm",
            "-v", "${targetVolume}:/target",
            "-v", "${backupPath}:/backup:ro",
            "alpine:3.20", "sh", "-ec", "rm -rf /target/* && tar xzf /backup/$($volume.archive) -C /target"
        )
    }

    $verification = Invoke-StagingCompose -ComposeArgs @("exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "vibe", "-d", "vibe_trading", "-tAc", "SELECT (SELECT count(*) FROM organizations), (SELECT count(*) FROM users), EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector');")
    if ([string]::IsNullOrWhiteSpace($verification)) {
        throw "Staging restore verification returned no database status"
    }
    Write-Host "Isolated restore drill passed: organizations, users, and pgvector are available ($verification)"
}
finally {
    if ($KeepStaging) {
        Write-Host "Keeping isolated staging project and volumes: $StagingProjectName"
    } else {
        Write-Host "Cleaning isolated staging project and volumes"
        $previousErrorAction = $ErrorActionPreference
        try {
            $ErrorActionPreference = "Continue"
            & docker compose --project-name $StagingProjectName --env-file $EnvFile -f docker-compose.prod.yml down --volumes --remove-orphans 2>$null
            foreach ($volume in $stagingVolumes) {
                & docker volume rm -f $volume 2>$null
            }
        } finally {
            $ErrorActionPreference = $previousErrorAction
        }
    }
}
