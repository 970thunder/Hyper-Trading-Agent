#!/usr/bin/env bash
# Deploy an already-tested main-branch commit on a Linux Docker Compose host.
set -Eeuo pipefail

APP_DIR="${HYPER_TRADING_APP_DIR:-/opt/hyper-trading-agent}"
DEPLOY_REF="${HYPER_TRADING_DEPLOY_REF:-origin/main}"
ENABLE_TLS="${HYPER_TRADING_ENABLE_TLS:-1}"
ENV_FILE="${HYPER_TRADING_ENV_FILE:-$APP_DIR/.env.production}"

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "Deployment directory is not a Git checkout: $APP_DIR" >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Production environment file is missing: $ENV_FILE" >&2
  exit 1
fi

cd "$APP_DIR"
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Deployment checkout has tracked local changes; refusing to overwrite it" >&2
  exit 1
fi

git fetch --prune origin main
target_commit="$(git rev-parse --verify "${DEPLOY_REF}^{commit}")"
if ! git merge-base --is-ancestor "$target_commit" origin/main; then
  echo "Deployment ref is not contained in origin/main: $DEPLOY_REF" >&2
  exit 1
fi
git checkout --detach "$target_commit"

compose=(docker compose --env-file "$ENV_FILE" -f "$APP_DIR/docker-compose.prod.yml" -f "$APP_DIR/docker-compose.server.yml")
if [[ "$ENABLE_TLS" == "1" || "$ENABLE_TLS" == "true" ]]; then
  compose+=(-f "$APP_DIR/docker-compose.tls.yml")
fi

"${compose[@]}" config --quiet
"${compose[@]}" pull --ignore-buildable
"${compose[@]}" up --build --detach --remove-orphans

HYPER_TRADING_APP_DIR="$APP_DIR" \
HYPER_TRADING_ENV_FILE="$ENV_FILE" \
HYPER_TRADING_ENABLE_TLS="$ENABLE_TLS" \
"$APP_DIR/scripts/verify-production.sh"

echo "Deployment complete: $target_commit"
