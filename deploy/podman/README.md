# Podman deployment (planning scaffold)

This directory contains the deployment plan artifacts. The app images
(`Containerfile.bot`, `Containerfile.mcp`) and `quadlet/` units are created in
Phase 1 of [docs/PLAN.md](../../docs/PLAN.md).

## Quickstart

```bash
# 1. Generate the minimal .env (only DISCORD_TOKEN is required)
export DISCORD_TOKEN="..."
../../scripts/podman-init.sh
# The script prints an invite URL; select the plan's minimal permissions.

# 2. Validate the compose file
../../scripts/podman-compose-smoke.sh

# 3. Start (after Phase 1 images exist)
podman compose -p siela -f compose.yaml up -d --build
```

## Files

| File | Purpose |
|---|---|
| `compose.yaml` | Core stack: Postgres, LibreTranslate, bot (yt-dlp + mpv), MCP, one-shot migrate. |
| `compose.host.yaml` | Optional override: publish MCP on `127.0.0.1:8080` for host-local clients. |
| `compose.proxy.yaml` | Optional override: Caddy TLS front door for external MCP clients. |
| `Caddyfile` | Optional TLS proxy config. |
| `.env.example` | Full config surface; prefer `scripts/podman-init.sh`. |

## Notes

- Use `-p siela` so network names are deterministic (`siela_mcp`, `siela_control`, ...).
- MCP is exposed on the Podman `mcp` network at `MCP_URL=http://mcp:8080/mcp`; it is not published to the host by default.
- Migrations run as a one-shot compose service (`migrate`) and are idempotent.
- The compose file avoids `profiles`, `secrets`, `build.target`, and `depends_on.condition` so it works with both `podman compose` providers.
