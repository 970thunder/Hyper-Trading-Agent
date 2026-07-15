#!/usr/bin/env bash
# Non-destructive production checks for a Linux Docker Compose host.
set -Eeuo pipefail

APP_DIR="${HYPER_TRADING_APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${HYPER_TRADING_ENV_FILE:-$APP_DIR/.env.production}"
API_BASE_URL="${HYPER_TRADING_API_BASE_URL:-http://127.0.0.1:8899}"
ENABLE_TLS="${HYPER_TRADING_ENABLE_TLS:-1}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Production environment file is missing: $ENV_FILE" >&2
  exit 1
fi

compose=(docker compose --env-file "$ENV_FILE" -f "$APP_DIR/docker-compose.prod.yml" -f "$APP_DIR/docker-compose.server.yml")
if [[ "$ENABLE_TLS" == "1" || "$ENABLE_TLS" == "true" ]]; then
  compose+=(-f "$APP_DIR/docker-compose.tls.yml")
fi

for service in api worker postgres redis gateway; do
  if ! "${compose[@]}" ps --status running --services | grep -Fxq "$service"; then
    echo "Production service is not running: $service" >&2
    exit 1
  fi
done

for _ in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 5 "$API_BASE_URL/health" | grep -q '"status":"healthy"'; then
    break
  fi
  sleep 2
done

if ! curl --fail --silent --show-error --max-time 5 "$API_BASE_URL/health" | grep -q '"status":"healthy"'; then
  echo "API health endpoint did not become ready" >&2
  exit 1
fi

anonymous_status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 "$API_BASE_URL/sessions")"
if [[ "$anonymous_status" != "401" ]]; then
  echo "Anonymous workspace request returned $anonymous_status instead of 401" >&2
  exit 1
fi

vector_status="$("${compose[@]}" exec -T api python -c 'from src.commercial.vector_store import build_vector_store_adapter; import json; print(json.dumps(build_vector_store_adapter().status()))')"
if [[ "$vector_status" != *'"active": "postgres-pgvector"'* || "$vector_status" != *'"available": true'* ]]; then
  echo "pgvector runtime is not available: $vector_status" >&2
  exit 1
fi

migration_table="$("${compose[@]}" exec -T postgres psql -U vibe -d vibe_trading -tAc "SELECT to_regclass('public.rag_vector_chunks')")"
if [[ "${migration_table//[[:space:]]/}" != "rag_vector_chunks" ]]; then
  echo "rag_vector_chunks migration is missing" >&2
  exit 1
fi

echo "Production readiness checks passed"
