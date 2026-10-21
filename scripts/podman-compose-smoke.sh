#!/usr/bin/env bash
# Siela Bot — podman compose smoke test.
#
# Usage:
#   scripts/podman-compose-smoke.sh          # validate config only
#   scripts/podman-compose-smoke.sh up       # config + up + health + down
#
# The `up` mode requires deploy/podman/.env and both Containerfiles.
# It never removes named volumes; pass KEEP=1 to leave the stack running.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/deploy/podman/compose.yaml"
ENV_FILE="${ROOT_DIR}/deploy/podman/.env"
ENV_EXAMPLE="${ROOT_DIR}/deploy/podman/.env.example"
COMPOSE=(podman compose -p siela -f "${COMPOSE_FILE}")

TMP_ENV=""
cleanup() {
  if [[ -n "${TMP_ENV}" && -f "${TMP_ENV}" ]]; then
    rm -f "${TMP_ENV}"
  fi
}
trap cleanup EXIT

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "note: ${ENV_FILE} not found; using .env.example for config validation"
  TMP_ENV="${ROOT_DIR}/deploy/podman/.env"
  cp "${ENV_EXAMPLE}" "${TMP_ENV}"
fi

echo "==> podman compose config"
"${COMPOSE[@]}" config >/dev/null
echo "config OK"

MODE="${1:-config}"
if [[ "${MODE}" != "up" ]]; then
  exit 0
fi

if [[ ! -f "${ROOT_DIR}/deploy/podman/Containerfile.bot" || ! -f "${ROOT_DIR}/deploy/podman/Containerfile.mcp" ]]; then
  echo "error: Containerfile.bot/Containerfile.mcp not found; run 'up' after Phase 1" >&2
  exit 1
fi

echo "==> podman compose up"
"${COMPOSE[@]}" up -d --build

echo "==> waiting for healthchecks"
for i in $(seq 1 30); do
  if podman healthcheck run siela-bot >/dev/null 2>&1 && \
     podman healthcheck run siela-mcp >/dev/null 2>&1; then
    echo "health OK"
    break
  fi
  sleep 5
  if [[ "${i}" == "30" ]]; then
    echo "error: healthchecks did not pass in time" >&2
    "${COMPOSE[@]}" ps
    exit 1
  fi
done

"${COMPOSE[@]}" ps

if [[ "${KEEP:-0}" != "1" ]]; then
  echo "==> podman compose down (volumes kept)"
  "${COMPOSE[@]}" down
fi
