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
ENV_FILE="${ROOT_DIR}/deploy/podman/.env"
ENV_EXAMPLE="${ROOT_DIR}/deploy/podman/.env.example"
COMPOSE=("${ROOT_DIR}/scripts/podman-stack.sh")

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

MCP_ENABLED="${MCP_ENABLED:-$(grep -E '^MCP_ENABLED=' "${ENV_FILE}" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '\r"' || true)}"
MCP_ENABLED="${MCP_ENABLED:-false}"
MCP_ENABLED="$(printf '%s' "${MCP_ENABLED}" | tr '[:upper:]' '[:lower:]')"
case "${MCP_ENABLED}" in
  1|true|yes|on) MCP_ON=1 ;;
  *) MCP_ON=0 ;;
esac
echo "MCP: $([[ "${MCP_ON}" == "1" ]] && echo enabled || echo disabled)"

echo "==> podman compose config"
"${COMPOSE[@]}" config >/dev/null
echo "config OK"

MODE="${1:-config}"
if [[ "${MODE}" != "up" ]]; then
  exit 0
fi

if [[ ! -f "${ROOT_DIR}/deploy/podman/Containerfile.bot" ]]; then
  echo "error: Containerfile.bot not found; run 'up' after Phase 1" >&2
  exit 1
fi
if [[ "${MCP_ON}" == "1" && ! -f "${ROOT_DIR}/deploy/podman/Containerfile.mcp" ]]; then
  echo "error: MCP_ENABLED is true but Containerfile.mcp is missing" >&2
  exit 1
fi

echo "==> podman compose up"
"${COMPOSE[@]}" up -d --build

echo "==> waiting for healthchecks"
for i in $(seq 1 30); do
  HEALTHY=1
  podman healthcheck run siela-bot >/dev/null 2>&1 || HEALTHY=0
  if [[ "${MCP_ON}" == "1" ]]; then
    podman healthcheck run siela-mcp >/dev/null 2>&1 || HEALTHY=0
  fi
  if [[ "${HEALTHY}" == "1" ]]; then
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
