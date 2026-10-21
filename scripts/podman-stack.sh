#!/usr/bin/env bash
# Siela Bot — Podman stack wrapper.
#
# MCP is optional. The flag is read from the environment first, then from
# deploy/podman/.env:
#
#   MCP_ENABLED=false  # bot + Postgres only (default)
#   MCP_ENABLED=true   # include the MCP server
#
# Examples:
#   scripts/podman-stack.sh up -d --build
#   scripts/podman-stack.sh logs -f bot
#   MCP_ENABLED=true scripts/podman-stack.sh up -d
#   scripts/podman-stack.sh down

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/deploy/podman/.env"
MCP_OVERLAY="${ROOT_DIR}/deploy/podman/compose.mcp.yaml"

if [[ -z "${MCP_ENABLED:-}" && -f "${ENV_FILE}" ]]; then
  MCP_ENABLED="$(grep -E '^MCP_ENABLED=' "${ENV_FILE}" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '\r"' || true)"
fi
MCP_ENABLED="${MCP_ENABLED:-false}"
MCP_ENABLED="$(printf '%s' "${MCP_ENABLED}" | tr '[:upper:]' '[:lower:]')"

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

exec "${COMPOSE[@]}" "$@"
