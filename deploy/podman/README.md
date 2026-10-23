# Podman deployment

Production stack for the Siela bot. All services run under one compose
project (`-p siela`); use `scripts/podman-stack.sh` for every compose
operation — it selects the MCP overlay. Raw `podman compose` commands bypass
the overlays.

## Services (`compose.yaml`)

| Service | Image | Notes |
|---|---|---|
| `postgres` | `postgres:17-alpine` | Data on `pgdata`; `data` network only |
| `valkey` | `valkey/valkey:8-alpine` | Append-only cache; `VALKEY_URL=redis://valkey:6379` |
| `llm` | `vllm/vllm-openai:v0.6.3` | GPU; model `Goekdeniz-Guelmez/Josiefied-Qwen2.5-1.5B-Instruct-abliterated-v3`; weights cached in `llmcache`; `/opt/nvidia-libs` bind |
| `tts` | `localhost/siela-tts:latest` | CPU; KittenTTS model baked at build; `:8000` `/healthz`, `/synthesize`, `/synthesize-stream` |
| `migrate` | `localhost/siela-bot:latest` | One-shot; migrations `0000`–`0010`; exits on success |
| `bot` | `localhost/siela-bot:latest` | `oven/bun` image; yt-dlp + mpv + ffmpeg; GPU devices passed through |

Health: bot listens on `127.0.0.1:3002` (`/healthz`, `/readyz`, `/metrics`,
not published to the host); control API on `:3001` (Bearer `MCP_TOKEN`,
`control` network only); TTS on `:8000`.

## Quickstart

```bash
# 1. Generate deploy/podman/.env (only DISCORD_TOKEN is required from you)
export DISCORD_TOKEN="..."
../../scripts/podman-stack.sh  # from deploy/podman, or:
./scripts/podman-init.sh       # from the repo root

# 2. Validate the compose config
./scripts/podman-compose-smoke.sh

# 3. Build and start
./scripts/podman-stack.sh up -d --build
./scripts/podman-stack.sh logs -f bot
```

## Wrapper

```bash
./scripts/podman-stack.sh up -d --build
./scripts/podman-stack.sh logs -f bot
./scripts/podman-stack.sh run --rm migrate
./scripts/podman-stack.sh down
```

`MCP_ENABLED` is read from the environment first, then from
`deploy/podman/.env`. `up`/`down` with the flag off also removes a leftover
`siela-mcp` container.

## Overlays

| File | Purpose |
|---|---|
| `compose.mcp.yaml` | Optional MCP server. Enabled with `MCP_ENABLED=true` |
| `compose.host.yaml` | Optional: publish MCP on `127.0.0.1:8080` for host-local clients (requires MCP overlay) |
| `compose.proxy.yaml` | Optional: Caddy TLS front door for external MCP clients |
| `compose.fast.yaml` | Fast code-only deploy: bind-mounts local `apps/bot/dist` over `/app/dist` (see `scripts/deploy-fast.sh`) |
| `Caddyfile` | TLS proxy config for the Caddy override |
| `.env.example` | Full config surface; prefer `scripts/podman-init.sh` |

```bash
# MCP on, published to host loopback:
MCP_ENABLED=true ./scripts/podman-stack.sh \
  -f deploy/podman/compose.yaml \
  -f deploy/podman/compose.mcp.yaml \
  -f deploy/podman/compose.host.yaml up -d
```

## MCP flag

MCP is **off by default**. Set in `.env`:

```env
MCP_ENABLED=false
```

To enable: `MCP_ENABLED=true ./scripts/podman-stack.sh up -d`.
When enabled, MCP is exposed on the Podman `mcp` network at
`MCP_URL=http://mcp:8080/mcp`; it is not published to the host by default.

## Notes

- Networks: `edge`, `data` (internal), `control` (internal), plus `mcp`
  (internal) when MCP is enabled.
- Migrations run as a one-shot compose service (`migrate`) and are
  idempotent; the bot also depends on `migrate`.
- The compose files avoid `profiles`, `secrets`, `build.target`, and
  `depends_on.condition` so they work with both `podman compose` providers.
- Updates: `git pull --ff-only`, rebuild, re-run `migrate`, then `up -d`
  (see `docs/RUNBOOK.md`).
