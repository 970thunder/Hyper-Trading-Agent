# Server Deployment Guide

This guide deploys Hyper Trading Agent behind an Nginx gateway. The API keeps a loopback-only host binding; Nginx is the only public listener and applies request limits and browser security headers.

## Prerequisites

- Docker Engine with Docker Compose v2.
- A DNS name pointing to the server for TLS deployment.
- A protected host directory for `.env.production` and certificate files.
- A generated PostgreSQL password, API key, and Fernet key. Do not reuse development credentials.

## Configure

```powershell
Copy-Item .env.production.example .env.production
```

Set these values before the first startup:

```env
POSTGRES_PASSWORD=<strong-random-password>
API_AUTH_KEY=<strong-random-token>
VIBE_TRADING_SECRET_KEY=<fernet-key>
API_BIND=127.0.0.1
API_PORT=8899
VIBE_TRADING_COOKIE_SECURE=true
VIBE_TRADING_TRUST_DOCKER_LOOPBACK=0
CORS_ORIGINS=https://agent.example.com
HYPER_TRADING_PLATFORM_ADMIN_EMAILS=owner@example.com
```

`HYPER_TRADING_PLATFORM_ADMIN_EMAILS` grants system-level `/platform` access only to explicit bootstrap accounts. It does not turn every organization Owner into a platform administrator.

## Start Behind HTTP Gateway

For an upstream TLS load balancer or a private proof-of-deployment environment:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.server.yml up --build -d
```

Nginx publishes port `80`, forwards traffic to the API service, rate-limits login requests to 5/minute per client and other API traffic to 20/second per client, and blocks public access to metrics and interactive API documentation. The `migrations` service records every applied SQL file and its SHA-256 checksum in `schema_migrations` before API and worker startup. A changed historical migration fails startup instead of silently drifting the production schema.

The production Compose profile also sets PostgreSQL as the primary repository for commercial identity, governance, knowledge lifecycle, and workspace ownership data. On the first API or worker access after enabling a new repository domain, existing SQLite compatibility records are copied idempotently and a domain marker is written to `commercial_repository_migrations`; a failed copy does not write the marker and keeps the service from silently treating a partial import as complete. Knowledge metadata, documents, chunks, ingestion jobs, and retrieval logs live in PostgreSQL; vectors remain in `rag_vector_chunks` so an embedding-model dimension change does not invalidate the lifecycle schema. Workspace session, run, artifact, and upload ownership records also use PostgreSQL, so tenant isolation is consistent across API and worker containers.

## Enable TLS

Place `fullchain.pem` and `privkey.pem` under `./certs` using an ACME client or your certificate manager, then start with the TLS overlay:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.server.yml -f docker-compose.tls.yml up --build -d
```

The TLS overlay publishes port `443`, redirects HTTP to HTTPS, enables TLS 1.2/1.3, and adds HSTS. Renew certificates with the chosen certificate manager, then reload the gateway:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.server.yml -f docker-compose.tls.yml exec gateway nginx -s reload
```

## Optional Observability

The `docker-compose.observability.yml` overlay starts Prometheus and Grafana.
Both default to `127.0.0.1`; expose them only through an authenticated VPN or
separate administrator gateway.

Create local secret files. The metrics file must contain the same exact value
as `API_AUTH_KEY`; do not commit this directory:

```powershell
New-Item -ItemType Directory -Force secrets | Out-Null
$apiKey = (Select-String -Path .env.production -Pattern '^API_AUTH_KEY=').Line.Split('=', 2)[1]
Set-Content -NoNewline -Path secrets/api_auth_key -Value $apiKey
$grafanaPassword = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
Set-Content -NoNewline -Path secrets/grafana_admin_password -Value $grafanaPassword
```

Then start the stack with the overlay:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.server.yml -f docker-compose.observability.yml up --build -d
```

Prometheus scrapes the protected internal `/metrics` endpoint using a Docker
secret. Grafana provisions the `Hyper Trading Agent Platform Overview`
dashboard with API health, model calls, RAG retrievals, tool calls, ingestion
failures, and tool errors. Open `http://127.0.0.1:3000` from the server or an
authorized tunnel, sign in with `GRAFANA_ADMIN_USER`, and immediately rotate
the generated password into the secret file if it is shared with another
operator.

## Initialize and Verify

Create the first organization Owner after the services are healthy:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml exec api python -m src.commercial.bootstrap --email owner@example.com --password "replace-with-a-long-password" --organization "Hyper Research"
```

The base production Compose file runs all idempotent SQL files in `migrations/` and initializes the application volumes before API and worker startup. Do not bypass these services with direct `docker run` commands; doing so can leave schema changes unapplied or create root-owned persistent files that the non-root application user cannot update.

Production Compose explicitly selects PostgreSQL as the primary identity and
authorization repository. Organizations, users, memberships, browser sessions,
and platform administrator grants are mirrored from a pre-existing application
volume during the first startup, then authenticated requests read PostgreSQL.
Keep `vibe-home` mounted and backed up as well: knowledge lifecycle, provider
configuration, audit, usage, and workspace metadata remain in the staged SQLite
compatibility repository until their domain migrations are complete.

Verify without exposing operational endpoints publicly:

```powershell
Invoke-WebRequest http://127.0.0.1:8899/health
docker compose --env-file .env.production -f docker-compose.prod.yml exec api python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8899/health').read().decode())"
```

Then sign in through the public domain, create an organization knowledge base, and verify that platform access appears only for the configured bootstrap account.

Run the repeatable pre-release check after every image rebuild:

```powershell
./scripts/verify-production.ps1 -EnvFile .env.production -ApiBaseUrl http://127.0.0.1:8899
```

It checks service state, API health, the anonymous workspace boundary, pgvector
runtime status, and the `rag_vector_chunks` migration without creating or
changing business data.

## Operations

- Use [backup and restore](operations-backup-restore.md) before upgrades and at least quarterly for restore drills.
- Use [secret rotation](operations-secret-rotation.md) for provider keys, API keys, and the encryption root key.
- Keep PostgreSQL, Redis, and the application volumes on persistent storage and monitor Docker health, gateway logs, worker failures, and `/metrics` from the internal Prometheus network.
- Do not publish port `8899` via a public firewall rule. The `API_BIND=127.0.0.1` setting is part of the server security boundary.
