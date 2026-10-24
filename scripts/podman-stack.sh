#!/usr/bin/env bash
# Siela Bot — Podman stack wrapper.
#
# MCP and watchtower are optional. Flags are read from the environment first,
# then from deploy/podman/.env:
#
#   MCP_ENABLED=false        # bot + Postgres only (default)
#   MCP_ENABLED=true         # include the MCP server
#   WATCHTOWER_ENABLED=false # no auto-deploy container (default)
#   WATCHTOWER_ENABLED=true  # include the watchtower auto-deploy container
#
# Examples:
#   scripts/podman-stack.sh up -d --build
#   scripts/podman-stack.sh logs -f bot
#   MCP_ENABLED=true scripts/podman-stack.sh up -d
#   WATCHTOWER_ENABLED=true scripts/podman-stack.sh up -d
#   scripts/podman-stack.sh down

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/deploy/podman/.env"
MCP_OVERLAY="${ROOT_DIR}/deploy/podman/compose.mcp.yaml"
WATCHTOWER_OVERLAY="${ROOT_DIR}/deploy/podman/compose.watchtower.yaml"

read_flag() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "${value}" && -f "${ENV_FILE}" ]]; then
    value="$(grep -E "^${name}=" "${ENV_FILE}" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '\r"' || true)"
  fi
  printf '%s' "${value:-false}" | tr '[:upper:]' '[:lower:]'
}

MCP_ENABLED="$(read_flag MCP_ENABLED)"
WATCHTOWER_ENABLED="$(read_flag WATCHTOWER_ENABLED)"

COMPOSE=(podman compose -p siela -f "${ROOT_DIR}/deploy/podman/compose.yaml")

case "${MCP_ENABLED}" in
  1|true|yes|on)
    COMPOSE+=(-f "${MCP_OVERLAY}")
    ;;
  *)
    # Remove a previously running MCP container when the flag is off.
    if [[ "${1:-}" == "up" || "${1:-}" == "down" ]]; then
      podman rm -f siela-mcp >/dev/null 2>&1 || true
    fi
    ;;
esac

case "${WATCHTOWER_ENABLED}" in
  1|true|yes|on)
    COMPOSE+=(-f "${WATCHTOWER_OVERLAY}")
    ;;
esac

exec "${COMPOSE[@]}" "$@"
