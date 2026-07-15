# Production Deployment Automation

This runbook uses a protected Linux server checkout plus GitHub Actions. It
does not copy `.env.production`, certificates, provider keys, or database data
through GitHub.

## Server Bootstrap

Use a dedicated non-root deployment user that belongs to the `docker` group.
On Ubuntu, install Docker Engine and Docker Compose v2, then create the
checkout once:

```bash
sudo useradd --create-home --shell /bin/bash hyperdeploy
sudo usermod -aG docker hyperdeploy
sudo mkdir -p /opt/hyper-trading-agent
sudo chown hyperdeploy:hyperdeploy /opt/hyper-trading-agent
sudo -u hyperdeploy git clone git@github.com:970thunder/Hyper-Trading-Agent.git /opt/hyper-trading-agent
sudo -u hyperdeploy cp /opt/hyper-trading-agent/.env.production.example /opt/hyper-trading-agent/.env.production
```

Edit `/opt/hyper-trading-agent/.env.production` with strong, server-specific
secrets. Keep `API_BIND=127.0.0.1`, `VIBE_TRADING_COOKIE_SECURE=true`, explicit
HTTPS `CORS_ORIGINS`, and at least one `HYPER_TRADING_PLATFORM_ADMIN_EMAILS`
address. Create `certs/fullchain.pem` and `certs/privkey.pem` before enabling
the default TLS deployment path.

Run the first deployment from the server:

```bash
cd /opt/hyper-trading-agent
chmod 700 scripts/deploy-production.sh scripts/verify-production.sh
HYPER_TRADING_ENABLE_TLS=1 ./scripts/deploy-production.sh
docker compose --env-file .env.production -f docker-compose.prod.yml exec api \
  python -m src.commercial.bootstrap --email owner@example.com --password 'long-unique-password' --organization 'Hyper Research'
```

The script only checks out commits that are contained in `origin/main`, refuses
tracked server-side edits, validates Compose, rebuilds the application image,
runs migrations through Compose, and checks health, authentication, pgvector,
and schema state before reporting success.

## GitHub Environment

Create a GitHub Environment named `production`. Require reviewers if a manual
approval is desired before any server update.

Add these repository or environment secrets:

| Secret | Value |
| --- | --- |
| `HYPER_TRADING_DEPLOY_HOST` | Server DNS name or IP address |
| `HYPER_TRADING_DEPLOY_USER` | `hyperdeploy` |
| `HYPER_TRADING_DEPLOY_PORT` | SSH port, normally `22` |
| `HYPER_TRADING_DEPLOY_PATH` | `/opt/hyper-trading-agent` |
| `HYPER_TRADING_DEPLOY_SSH_KEY` | Private deploy key for `hyperdeploy` |
| `HYPER_TRADING_DEPLOY_KNOWN_HOSTS` | Pinned output of `ssh-keyscan -H -p <port> <host>` captured through a trusted channel |

Set the environment variable `HYPER_TRADING_DEPLOY_TLS=1` unless a trusted
upstream TLS gateway terminates HTTPS. Never use a private key or any value
from `.env.production` as a GitHub repository variable.

Add the deploy key public half to `/home/hyperdeploy/.ssh/authorized_keys` on
the server. Use a separate read-only GitHub deploy key for the server checkout
if the repository is private.

## Daily Workflow

1. Develop on a feature branch and open a pull request to `main`.
2. Let the existing `CI` workflow finish successfully.
3. Merge the pull request into protected `main`.
4. `Deploy Production` starts automatically from the exact successful CI SHA,
   connects over pinned-host-key SSH, and runs `scripts/deploy-production.sh`.
5. Review the workflow log and `docker compose ps` on the server.

For a controlled repeat deployment, open **Actions -> Deploy Production -> Run
workflow**, supply `main` or a tested commit SHA, and approve the `production`
environment. The server rejects any SHA that is not reachable from `main`.

## Rollback

Select a previously successful commit SHA in the manual workflow. The server
only changes application code and containers; PostgreSQL and named volumes stay
in place. A rollback cannot undo a database migration, so back up before a
schema-changing release and follow [backup and restore](operations-backup-restore.md)
when data rollback is required.
