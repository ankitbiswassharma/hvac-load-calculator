#!/usr/bin/env bash
set -euo pipefail

APP_DOMAIN="${APP_DOMAIN:-hvac.muskit.in}"
APP_DIR="${APP_DIR:-/opt/hvac}"
# Production Traefik stack on the Hostinger VPS lives here and uses the
# Docker network "app_default". Override via env vars if your layout differs.
TRAEFIK_PROJECT_DIR="${TRAEFIK_PROJECT_DIR:-/home/webapp/app}"
TRAEFIK_NETWORK="${TRAEFIK_NETWORK:-app_default}"
TRAEFIK_DYNAMIC_DIR="${TRAEFIK_DYNAMIC_DIR:-${TRAEFIK_PROJECT_DIR}/traefik/dynamic}"
ROUTE_SOURCE="${APP_DIR}/deploy/traefik/dynamic/hvac.yml"
ROUTE_DEST="${TRAEFIK_DYNAMIC_DIR}/hvac.yml"

cd "${APP_DIR}"

if [ ! -f .env ]; then
  cp .env.example .env
fi

set_env_value() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" .env; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '\n%s=%s\n' "${key}" "${value}" >> .env
  fi
}

set_env_value NODE_ENV production
set_env_value HOST 0.0.0.0
set_env_value PORT 3000
set_env_value APP_BASE_URL "https://${APP_DOMAIN}"
set_env_value SESSION_COOKIE_SECURE 1

git config --global --add safe.directory "${APP_DIR}"
git pull --rebase origin main

docker compose up -d --build

container_id="$(docker compose ps -q app)"
if [ -z "${container_id}" ]; then
  echo "Could not find the HVAC app container from docker compose ps." >&2
  exit 1
fi

docker network connect "${TRAEFIK_NETWORK}" "${container_id}" 2>/dev/null || true
docker network connect "${TRAEFIK_NETWORK}" hvac-app 2>/dev/null || true

mkdir -p "${TRAEFIK_DYNAMIC_DIR}"
cp "${ROUTE_SOURCE}" "${ROUTE_DEST}"

docker compose -f "${TRAEFIK_PROJECT_DIR}/docker-compose.yml" restart traefik

curl -fsSIk "https://${APP_DOMAIN}/" | head -n 20
