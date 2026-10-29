# Podman deployment

Production stack for Siela Bot. All services run under one compose project (`-p siela`). Use `scripts/podman-stack.sh` for compose operations. The wrapper selects the watchtower overlay when `WATCHTOWER_ENABLED=true`.

## Prerequisites

- Linux host with Podman 5 or newer and a compose provider.
- cgroups v2.
- About 25 GB of free disk for images and model weights.
- Outbound access to container registries, Hugging Face, Discord, and the music providers.
- NVIDIA GPU with a driver that supports CUDA 12.8 (550 or newer; verified on
  595.112.07), plus matching driver userspace libraries in `/opt/nvidia-libs`
  (`libcuda.so.1`, `libnvidia-ml.so.1`, `libnvidia-ptxjitcompiler.so.1`,
  `libnvidia-gpucomp.so.1`). They must be the same version as the kernel
  module, or CUDA init fails and llama.cpp quietly falls back to CPU. Podman
  here has no CDI spec, so the compose file passes `/dev/nvidia*` and mounts
  those libraries directly.

The `llm` service runs llama.cpp with CUDA and keeps the weights in VRAM, which
frees about 1 GB of system RAM and is roughly nine times faster than CPU. Set
`-ngl 0` and remove the devices and library mount to fall back to CPU.

## Services

```mermaid
flowchart LR
  BOT[bot, commander]
  ROUTER[router]
  W1[bot-voice-1]
  WN[bot-voice-N]
  LLM[llama.cpp :8000]
  PG[(PostgreSQL)]
  VK[(Valkey)]
  TTS[KittenTTS]
  MIG[migrate, one-shot]
  WT[watchtower, optional]

  EDGE((edge, routable))
  DATA((data, internal))
  CONTROL((control, internal))

  BOT --- EDGE
  BOT --- DATA
  BOT --- CONTROL
  ROUTER --- CONTROL
  ROUTER --- DATA
  W1 --- EDGE
  W1 --- DATA
  W1 --- CONTROL
  WN --- EDGE
  WN --- DATA
  WN --- CONTROL
  LLM --- EDGE
  LLM --- CONTROL
  PG --- DATA
  VK --- DATA
  TTS --- DATA
  MIG --- DATA
  WT --- EDGE

  subgraph NT[Networks]
    EDGE
    DATA
    CONTROL
  end
```

Workers only exist when `scripts/make-voice-overlay.sh <N>` has generated the overlay. `router` always runs; without workers its only node is the commander, so the fleet is a semaphore of one.

| Service | Image | Notes |
|---|---|---|
| `postgres` | `postgres:17-alpine` | Data on `pgdata`; `data` network only |
| `valkey` | `valkey/valkey:8-alpine` | Append-only cache; `VALKEY_URL=redis://valkey:6379` |
| `llm` | `ghcr.io/ggml-org/llama.cpp:server-cuda` | Model `DeathSurfing/tinyTanLLM-delulu-gemma` (`delulu-gemma-q4_k_m.gguf`, ctx 1024, q8_0 KV, flash attention, n-gram speculation, single slot, no host prompt cache); all 27 layers in VRAM (~2 GB), ~220-250 MB host RAM, 90-120 tok/s. Weights cached in `llmcache`. |
| `tts` | `localhost/siela-tts:latest` | CPU; KittenTTS model baked at build but loaded lazily; `/healthz`, `/warmup`, `/unload`, `/synthesize`, `/synthesize-stream` |
| `migrate` | `localhost/siela-bot:latest` | One-shot migration runner; exits after the schema is current |
| `bot` | `localhost/siela-bot:latest` | `oven/bun` image with yt-dlp, mpv, and ffmpeg; commander by default (`NODE_ROLE=commander`) |
| `router` | `localhost/siela-router:latest` | Voice fleet gateway `:3100`; fans music out by `nodeId`, proxies everything else to the commander |
| `bot-voice-*` | `localhost/siela-bot:latest` | Generated workers (`scripts/make-voice-overlay.sh <N>`). Slim `dist/worker.js` entrypoint under `bun --smol`, 1 GB cap: voice + music/TTS + worker API only, no commands or schedulers |
| `bot-voice-*` (Rust) | `localhost/siela-voice-worker:latest` | Same slots with `WORKER_RUNTIME=rust`. `apps/voice-worker`, 512 MB cap, decodes in process so no mpv or ffmpeg runs during playback |
| `dashboard` | `localhost/siela-dashboard:latest` | Optional operator UI on container port 3000, published at `${DASHBOARD_PORT}`; reads its sign-in settings from `.env`; not built or started by watchtower |
| `watchtower` | `localhost/siela-watchtower:latest` | Optional auto-deploy sidecar; mounts the host Podman socket |

Health endpoints:

- Bot health and metrics: `127.0.0.1:3002` (`/healthz`, `/readyz`, `/metrics`). The port is not published to the host.
- Control API: `:3001` with Bearer `MCP_TOKEN`, on the internal `control` network.
- Voice router: `:3100` with Bearer `MCP_TOKEN`, on the internal `control` network. See [docs/VOICE-FLEET.md](../../docs/VOICE-FLEET.md).
- TTS: `:8000` with `/healthz`, `/warmup`, `/unload`, `/synthesize`, and `/synthesize-stream`. The model is loaded on demand, so idle memory is low.

### Dashboard

The dashboard is optional and is not in the watchtower deploy set. Its sign-in settings and session secret are read from `deploy/podman/.env` through `env_file`, so keep them there. The session secret must have at least 32 characters. When a password is set, it must have at least 12. Remove the password to require Discord sign-in.

Set a free host port in `.env` when 3000 is already taken:

```sh
# Optional password fallback, 12+ characters. Omit it for Discord-only sign-in.
# DASHBOARD_PASSWORD=...
DASHBOARD_SESSION_SECRET=...
DASHBOARD_PORT=3002
DASHBOARD_BIND=0.0.0.0
```

Build and start it after a stack update:

```sh
cd deploy/podman
podman-compose -p siela -f compose.yaml -f compose.voice.generated.yaml -f compose.watchtower.yaml build dashboard
podman-compose -p siela -f compose.yaml -f compose.voice.generated.yaml -f compose.watchtower.yaml up -d --no-deps dashboard
curl -fsS http://127.0.0.1:3002/healthz
```

Open `http://<host>:${DASHBOARD_PORT}`. The container listener remains 3000; on this host the portfolio owns 3000, so the dashboard is published on 3002.

For Discord OAuth, set all four of `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DASHBOARD_OAUTH_REDIRECT_URI`, and `DASHBOARD_OWNER_IDS` in `.env`, and register the exact callback in the Discord application. When `DASHBOARD_PASSWORD` is unset, the four OAuth values are the only sign-in method, and the dashboard exits at startup if they are incomplete. Behind Caddy set `DASHBOARD_TRUST_PROXY=true` and keep `DASHBOARD_SECURE_COOKIES=false` while the LAN HTTP URL is still used. See [docs/DASHBOARD.md](../../docs/DASHBOARD.md) for the full environment table, the public HTTPS flow, and the security boundary.

## Quickstart

Run these commands from the repository root:

```bash
export DISCORD_TOKEN="..."
export GUILD_ID="..."

./scripts/podman-init.sh
./scripts/podman-stack.sh up -d --build
./scripts/podman-stack.sh logs -f bot
```

`DISCORD_TOKEN` is the only secret you must provide. The init script generates the database and control-API secrets, writes `deploy/podman/.env` with mode 600, and prints an invite URL with the recommended permissions.

See [GET_STARTED.md](../../GET_STARTED.md) for the full first-run checklist.

## Wrapper

```bash
./scripts/podman-stack.sh up -d --build
./scripts/podman-stack.sh logs -f bot
./scripts/podman-stack.sh run --rm migrate
./scripts/podman-stack.sh down
```

When the flag is off, `up` and `down` remove a leftover `siela-mcp` container from pre-retirement deployments.

## Overlays

| File | Purpose |
|---|---|
| `compose.voice.generated.yaml` | Generated voice workers. Created by `scripts/make-voice-overlay.sh <N>`; auto-included when present. Set `WORKER_RUNTIME=rust` to emit Rust workers instead of Bun |
| `compose.watchtower.yaml` | Optional auto-deploy sidecar. Enabled with `WATCHTOWER_ENABLED=true` |
| `compose.fast.yaml` | Fast code-only deploy. Bind-mounts `apps/bot/dist` over `/app/dist` |
| `.env.example` / `.env.voice.example` | Configuration references. Prefer `scripts/podman-init.sh` |

## Watchtower (automatic updates)

The optional `watchtower` container makes the configured branch the source of truth. It polls every 60 seconds, waits for CI on the new commit, fast-forwards the checkout, rebuilds, runs migrations, and recreates the stack (bot, TTS, router, voice workers — never itself). When the bot fails its health gate, it resets to the previous commit, redeploys it, and blocks the bad commit. Rebuild the watchtower image by hand after watchtower code changes; it never redeploys itself.

```bash
# One-time: build the watchtower image and start it with the stack.
podman build --network=host -f deploy/podman/Containerfile.watchtower \
  -t localhost/siela-watchtower:latest .
mkdir -p node_modules
WATCHTOWER_ENABLED=true ./scripts/podman-stack.sh up -d watchtower
```

Required in `deploy/podman/.env` when enabled:

| Variable | Purpose |
|---|---|
| `WATCHTOWER_ENABLED` | `true` includes the overlay |
| `WATCHTOWER_REPO_DIR` | Absolute host path of this checkout, for example `/root/siela-bot` |
| `WATCHTOWER_TOKEN` | Bearer token for `POST /trigger`; `scripts/podman-init.sh` generates it |

Common overrides:

| Variable | Default | Purpose |
|---|---|---|
| `WATCHTOWER_REPO_URL` | upstream repository | Point at a fork to follow it instead |
| `WATCHTOWER_BRANCH` | `main` | Branch to follow |
| `GH_TOKEN` | empty | Required for private forks; avoids anonymous GitHub API limits |
| `WATCHTOWER_CI_GATE` | `auto` | `auto`, `required`, or `off` |
| `WATCHTOWER_HEALTH_TIMEOUT_SEC` | `180` | Time allowed for `/readyz` before rollback |
| `WATCHTOWER_BUILD_NETWORK` | empty | Passed as `podman build --network=...`; use `host` if builds need it |
| `WATCHTOWER_DRY_RUN` | `false` | Log the decision without pulling or deploying |
| `WATCHTOWER_NOTIFY_WEBHOOK_URL` | empty | Discord webhook for deploy and rollback messages |

Deploy modes:

| Mode | Trigger | Action |
|---|---|---|
| `none` | Docs-only change | Pull, but do not rebuild |
| `fast` | Every change under `apps/bot/src/` | Rebuild `apps/bot/dist` and recreate the bot |
| `full` | Anything else | Rebuild images, run migrations, recreate services |

CI gate values:

- `auto` waits for checks; if none appear within `WATCHTOWER_CI_GRACE_SEC`, it deploys ungated.
- `required` waits the full `WATCHTOWER_CI_TIMEOUT_SEC` and defers when no checks appear.
- `off` skips the gate.

Operate it:

```bash
podman logs -f siela-watchtower
podman healthcheck run siela-watchtower
podman exec siela-watchtower bun -e \
  "fetch('http://127.0.0.1:3003/status').then(r=>r.text()).then(console.log)"

# Force a retry after a blocked commit (token from .env).
podman exec siela-watchtower bun -e \
  "fetch('http://127.0.0.1:3003/trigger',{method:'POST',headers:{authorization:'Bearer '+process.env.WATCHTOWER_TOKEN,'content-type':'application/json'},body:'{\"force\":true}'})"
```

The port is not published. `POST /trigger` accepts `{"force":true}` to clear a blocked commit.

To disable, set `WATCHTOWER_ENABLED=false` and remove the container. The wrapper does not remove it automatically because a deploy issued from inside the container would kill itself:

```bash
podman rm -f siela-watchtower
```

Watchtower deploys the stack, not itself. After it changes, rebuild and recreate it manually:

```bash
WATCHTOWER_ENABLED=true ./scripts/podman-stack.sh up -d --build watchtower
```

> **Security:** the container mounts the rootful Podman socket, which is equivalent to root on the host, and it pulls code from the configured repository. Only point it at a repository you control. Prefer HTTPS with a repo-scoped `GH_TOKEN`; the CI gate reduces, but does not remove, supply-chain risk.

## Notes

- Networks: `edge`, `data` (internal), and `control` (internal).
- The `migrate` service is one-shot and idempotent. The bot is ordered after the container starts, not after it exits.
- The compose files avoid `profiles`, `secrets`, `build.target`, and `depends_on.condition` so they work with both `podman compose` providers.
- Updates: `git pull --ff-only`, rebuild, run `migrate`, then start the stack. See [docs/RUNBOOK.md](../../docs/RUNBOOK.md). The optional `watchtower` container automates this flow.
- The compose stack runs on CPU. The Delulu model is a small quantized llama.cpp build with a fallback chain when the service is unavailable.
