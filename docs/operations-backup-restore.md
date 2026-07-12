# Backup and Restore Runbook

This runbook is for private Docker Compose deployments of Hyper Trading Agent.

## What Must Be Backed Up

- PostgreSQL database: organizations, users, model provider metadata, RAG metadata, audit logs, usage, and job state.
- Object/file storage: uploaded source files, parsed documents, generated reports, run artifacts, and exports.
- `.env.production`: deployment settings and bootstrap secrets. Store this separately in a secure password manager or secret manager.
- Optional MinIO/S3 bucket: original documents and large artifacts if object storage is enabled.

Do not rely on container images as backups. Containers are disposable.

## PostgreSQL Backup

Create a dated backup:

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
New-Item -ItemType Directory -Force backups | Out-Null
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres pg_dump -U hyper_trading hyper_trading | Set-Content -Encoding UTF8 "backups/postgres-$stamp.sql"
```

Verify the file exists and is non-empty:

```powershell
Get-Item "backups/postgres-$stamp.sql" | Select-Object Name,Length
```

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
docker compose --env-file .env.production -f docker-compose.prod.yml stop api worker frontend
```

2. Restore PostgreSQL:

```powershell
Get-Content backups/postgres-YYYYMMDD-HHMMSS.sql | docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres psql -U hyper_trading hyper_trading
```

3. Restore artifacts or object storage from the matching backup.
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

- PostgreSQL: daily full backup, retain at least 30 days.
- Artifacts/object storage: daily incremental or provider-native versioned backup.
- `.env.production` and root keys: back up after every rotation.
- Restore drill: at least once per quarter and before major upgrades.

## Failure Rules

- If database restore succeeds but artifacts are missing, disable document download and report export until artifacts are restored.
- If artifacts restore succeeds but database restore fails, do not point production traffic at the partial environment.
- If `VIBE_TRADING_SECRET_KEY` is missing or changed unexpectedly, encrypted provider keys may be unreadable; restore the matching secret key or run the planned re-encryption migration.

