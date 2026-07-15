#!/usr/bin/env bash
# Deploy a verified GHCR image without requiring a source checkout on the host.
set -Eeuo pipefail

APP_DIR="${HYPER_TRADING_APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
COMPOSE_FILE="${HYPER_TRADING_REGISTRY_COMPOSE_FILE:-$APP_DIR/docker-compose.yml}"
ENV_FILE="${HYPER_TRADING_ENV_FILE:-$APP_DIR/.env}"
IMAGE="${HYPER_TRADING_IMAGE:-ghcr.io/970thunder/hyper-trading-agent}"
IMAGE_TAG="${HYPER_TRADING_IMAGE_TAG:-}"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Registry Compose file is missing: $COMPOSE_FILE" >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Registry environment file is missing: $ENV_FILE" >&2
  exit 1
fi
if [[ -z "$IMAGE_TAG" ]]; then
  echo "HYPER_TRADING_IMAGE_TAG is required" >&2
  exit 1
fi
if [[ ! "$IMAGE_TAG" =~ ^(main|sha-[0-9a-f]{40})$ ]]; then
  echo "Refusing unsupported image tag: $IMAGE_TAG" >&2
  exit 1
fi

cd "$APP_DIR"
compose=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

HYPER_TRADING_IMAGE="$IMAGE" HYPER_TRADING_IMAGE_TAG="$IMAGE_TAG" "${compose[@]}" config --quiet
docker pull "$IMAGE:$IMAGE_TAG"
HYPER_TRADING_IMAGE="$IMAGE" HYPER_TRADING_IMAGE_TAG="$IMAGE_TAG" "${compose[@]}" pull
HYPER_TRADING_IMAGE="$IMAGE" HYPER_TRADING_IMAGE_TAG="$IMAGE_TAG" "${compose[@]}" up --detach --remove-orphans

HYPER_TRADING_APP_DIR="$APP_DIR" \
HYPER_TRADING_REGISTRY_COMPOSE_FILE="$COMPOSE_FILE" \
HYPER_TRADING_ENV_FILE="$ENV_FILE" \
HYPER_TRADING_IMAGE="$IMAGE" \
HYPER_TRADING_IMAGE_TAG="$IMAGE_TAG" \
"$APP_DIR/scripts/verify-registry-production.sh"

echo "Registry deployment complete: $IMAGE:$IMAGE_TAG"
