# Backup and Restore Runbook

This runbook is for private Docker Compose deployments of Hyper Trading Agent.

## What Must Be Backed Up

- PostgreSQL database: pgvector chunks and the staged commercial schema.
- Application SQLite volume (`vibe-home`): active organization metadata, users, memberships, model-provider metadata, RAG lifecycle records, audit logs, usage, and workspace ownership until the PostgreSQL-primary repository migration is complete.
- Object/file storage: uploaded source files, parsed documents, generated reports, run artifacts, sessions, and exports.
- `.env.production`: deployment settings and bootstrap secrets. Store this separately in a secure password manager or secret manager.
- Optional MinIO/S3 bucket: original documents and large artifacts if object storage is enabled.

Do not rely on container images as backups. Containers are disposable.

## PostgreSQL Backup

Create a dated backup:

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
New-Item -ItemType Directory -Force backups | Out-Null
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres pg_dump -U vibe vibe_trading | Set-Content -Encoding UTF8 "backups/postgres-$stamp.sql"
```

Verify the file exists and is non-empty:

```powershell
Get-Item "backups/postgres-$stamp.sql" | Select-Object Name,Length
```

## Application Volume Backup

The production Compose project is named `hyper-trading-agent`. Back up the
commercial SQLite database and all application artifacts from named volumes in
addition to PostgreSQL:

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
New-Item -ItemType Directory -Force backups | Out-Null
foreach ($volume in "vibe-home", "vibe-uploads", "vibe-runs", "vibe-sessions") {
  docker run --rm -v "hyper-trading-agent_$volume`:/source:ro" -v "${PWD}/backups:/backup" alpine:3.20 `
    tar czf "/backup/$volume-$stamp.tgz" -C /source .
}
Get-ChildItem "backups/*-$stamp.tgz" | Select-Object Name,Length
```

Do not omit `vibe-home`: it contains the active commercial SQLite repository
while the PostgreSQL-primary migration remains in progress.

## File and Artifact Backup

For named Docker volumes, inspect the compose file and back up the mounted volume data. If the deployment uses a host-mounted `output/`, `uploads/`, or object-storage directory, copy it with metadata preserved:

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Compress-Archive -Path output,uploads -DestinationPath "backups/artifacts-$stamp.zip" -Force
```

For MinIO/S3-compatible storage:

1. Export the bucket with the provider's native tool.
2. Save bucket policy and lifecycle rules.
3. Verify object count and total size after export.

## Restore Drill

Run restores into a clean staging environment first.

1. Stop application services:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml stop api worker
```

2. Restore PostgreSQL:

```powershell
Get-Content backups/postgres-YYYYMMDD-HHMMSS.sql | docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres psql -U vibe vibe_trading
```

3. Restore each matching named-volume archive before starting the API/worker:

```powershell
docker run --rm -v hyper-trading-agent_vibe-home:/target -v "${PWD}/backups:/backup:ro" alpine:3.20 `
  sh -ec "rm -rf /target/* && tar xzf /backup/vibe-home-YYYYMMDD-HHMMSS.tgz -C /target"
```

Repeat for `vibe-uploads`, `vibe-runs`, and `vibe-sessions`, then restore any
external object storage from the matching backup.

4. Start services:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

5. Validate:

- Login with an Owner account.
- Open Settings -> Model configuration and run a provider connection test.
- Open Knowledge base and search a known document.
- Open a historical session and confirm messages, citations, and run cards render.
- Open Audit and Usage to confirm historical rows are present.

## Backup Schedule

- PostgreSQL and `vibe-home`: daily full backup, retain at least 30 days.
- Artifacts/object storage: daily incremental or provider-native versioned backup.
- `.env.production` and root keys: back up after every rotation.
- Restore drill: at least once per quarter and before major upgrades.

## Failure Rules

- If database restore succeeds but artifacts are missing, disable document download and report export until artifacts are restored.
- If artifacts restore succeeds but database restore fails, do not point production traffic at the partial environment.
- If `VIBE_TRADING_SECRET_KEY` is missing or changed unexpectedly, encrypted provider keys may be unreadable; restore the matching secret key or run the planned re-encryption migration.
