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

Nginx publishes port `80`, forwards traffic to the API service, rate-limits login requests to 5/minute per client and other API traffic to 20/second per client, and blocks public access to metrics and interactive API documentation.

## Enable TLS

Place `fullchain.pem` and `privkey.pem` under `./certs` using an ACME client or your certificate manager, then start with the TLS overlay:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.server.yml -f docker-compose.tls.yml up --build -d
```

The TLS overlay publishes port `443`, redirects HTTP to HTTPS, enables TLS 1.2/1.3, and adds HSTS. Renew certificates with the chosen certificate manager, then reload the gateway:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.server.yml -f docker-compose.tls.yml exec gateway nginx -s reload
```

## Initialize and Verify

Create the first organization Owner after the services are healthy:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml exec api python -m src.commercial.bootstrap --email owner@example.com --password "replace-with-a-long-password" --organization "Hyper Research"
```

Verify without exposing operational endpoints publicly:

```powershell
Invoke-WebRequest http://127.0.0.1:8899/health
docker compose --env-file .env.production -f docker-compose.prod.yml exec api python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8899/health').read().decode())"
```

Then sign in through the public domain, create an organization knowledge base, and verify that platform access appears only for the configured bootstrap account.

## Operations

- Use [backup and restore](operations-backup-restore.md) before upgrades and at least quarterly for restore drills.
- Use [secret rotation](operations-secret-rotation.md) for provider keys, API keys, and the encryption root key.
- Keep PostgreSQL and Redis volumes on persistent storage and monitor Docker health, gateway logs, worker failures, and `/metrics` from an internal Prometheus network.
- Do not publish port `8899` via a public firewall rule. The `API_BIND=127.0.0.1` setting is part of the server security boundary.
