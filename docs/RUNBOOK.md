# Siela Bot Runbook

Always use the wrapper (`scripts/podman-stack.sh`) for compose operations. It selects the MCP overlay from `MCP_ENABLED`. Raw `podman compose` commands bypass the overlays.

For the full first-run checklist, see [GET_STARTED.md](../GET_STARTED.md).

## First deploy

```bash
git clone https://github.com/DeathSurfing/siela-nogseuui-seobeo-bot.git
cd siela-nogseuui-seobeo-bot

export DISCORD_TOKEN="..."
export GUILD_ID="..."   # recommended for a single-guild install
./scripts/podman-init.sh

./scripts/podman-stack.sh up -d --build
podman ps --format '{{.Names}}\t{{.Status}}'
```

The init script prints an invite URL with the recommended permissions. If `GUILD_ID` is unset, the bot auto-detects the only guild it can see. If it joins another guild first, it binds there and leaves the others.

The bot container starts after the `migrate` container starts, but compose does not wait for the migration to finish. If the first boot reports a database error, wait for `migrate` to exit and restart the bot.

## Common commands

```bash
# logs
./scripts/podman-stack.sh logs -f bot

# restart the bot
./scripts/podman-stack.sh restart bot

# health (health port 3002 is NOT published; query from inside the container)
podman healthcheck run siela-bot
podman exec siela-bot python3 -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:3002/healthz', timeout=5).read())"
podman exec siela-bot python3 -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:3002/readyz', timeout=10).read())"

# stop the stack (volumes are kept)
./scripts/podman-stack.sh down

# destroy everything, including the database
./scripts/podman-stack.sh down -v
```

## Service checks

```bash
# Postgres + Valkey
podman exec siela-postgres pg_isready -U "${POSTGRES_USER:-siela}" -d "${POSTGRES_DB:-siela}"
podman exec siela-valkey valkey-cli ping

# vLLM (OpenAI-compatible; no auth on the compose network)
podman exec siela-bot python3 -c "import urllib.request; print(urllib.request.urlopen('http://llm:8000/health', timeout=30).status)"

# KittenTTS service
podman exec siela-bot python3 -c "import urllib.request; print(urllib.request.urlopen('http://tts:8000/healthz', timeout=10).read())"
podman exec siela-bot python3 -c "import json,urllib.request; req=urllib.request.Request('http://tts:8000/synthesize', data=json.dumps({'text':'runbook check'}).encode(), headers={'Content-Type':'application/json'}); print(urllib.request.urlopen(req, timeout=60).status)"

# control API (Bearer MCP_TOKEN, control network only)
podman exec siela-bot python3 -c "import os,urllib.request; print(urllib.request.urlopen(urllib.request.Request('http://bot-control:3001/v1/status', headers={'Authorization':'Bearer '+os.environ['MCP_TOKEN']}), timeout=10).status)"

# re-run one-shot migrations (idempotent, 30 DB-readiness retries)
./scripts/podman-stack.sh run --rm migrate
```

`podman healthcheck run siela-bot` checks `/healthz`, which only proves that the process is alive. Use `/readyz` or the logs when you need to confirm that the gateway and guild are ready.

## Updates

```bash
git pull --ff-only
./scripts/podman-stack.sh build
./scripts/podman-stack.sh run --rm migrate
./scripts/podman-stack.sh up -d
```

For a code-only deployment, build locally and use the fast overlay:

```bash
REMOTE=user@host SSH_KEY=~/.ssh/your-key ./scripts/deploy-fast.sh
```

The fast script requires `REMOTE`. It builds `apps/bot/dist`, copies it to the server, recreates the bot container, and starts it with `compose.fast.yaml`.

## Backups

```bash
mkdir -p /var/backups/siela
set -a; . deploy/podman/.env; set +a
podman exec siela-postgres pg_dump -U "${POSTGRES_USER:-siela}" -Fc "${POSTGRES_DB:-siela}" \
  | gzip > "/var/backups/siela/siela-$(date +%F).dump.gz"
```

Restore (stop the bot first so nothing writes mid-restore, and stop MCP if it is enabled):

```bash
set -a; . deploy/podman/.env; set +a
./scripts/podman-stack.sh stop bot
podman stop siela-mcp >/dev/null 2>&1 || true
gunzip -c /var/backups/siela/siela-YYYY-MM-DD.dump.gz \
  | podman exec -i siela-postgres pg_restore -U "${POSTGRES_USER:-siela}" -d "${POSTGRES_DB:-siela}" --clean --if-exists
./scripts/podman-stack.sh up -d
```

## Remote Podman Desktop

Podman Desktop can manage a remote stack over SSH. The remote host needs the rootful Podman socket (`/run/podman/podman.sock`). Enable `podman.socket` on that host before connecting.

On the client machine:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/siela_podman_ed25519
ssh-copy-id -i ~/.ssh/siela_podman_ed25519.pub root@<server-ip>

podman system connection add siela-server \
  --identity "$HOME/.ssh/siela_podman_ed25519" \
  ssh://root@<server-ip>/run/podman/podman.sock
```

Then enable **Podman Desktop → Settings → Preferences → Enable remote
connections** (setting key `podman.system.connections.remote`). The
connection appears as `siela-server` in the container engine picker.

This is a rootful connection: the SSH key has full control of the server.
Restrict it to the LAN in `/root/.ssh/authorized_keys` and revoke it when not
needed. Remove the connection with:

```bash
podman system connection remove siela-server
```

## Troubleshooting

- **Bot exits with `Invalid environment`**: check `deploy/podman/.env`; `DISCORD_TOKEN` (min 20 chars) is required and internal secrets are generated by `scripts/podman-init.sh`. `MCP_TOKEN` must be at least 16 chars.
- **Bot is not in the guild**: invite it with the `bot` and `applications.commands` scopes and `permissions=322292816`. Reuse the URL printed by `scripts/podman-init.sh`.
- **Music does not play**: check `podman exec siela-bot yt-dlp --version` and `podman exec siela-bot mpv --version`. Music uses yt-dlp + mpv, not Lavalink. Spotify tracks are resolved through Spotify's public oEmbed metadata, and Spotify playlists/albums (first 50 tracks) are read from Spotify's public embed metadata; each track is then matched to a YouTube result. No Spotify credentials are required.
- **Tambola TTS is silent**: check the lobby card's TTS line. Tambola needs `Connect` and `Speak` in the selected voice channel. First check the KittenTTS service (`http://tts:8000/healthz` and `/synthesize` per Service checks above) and `TTS_SERVICE_URL`/`TTS_STREAM`/`TTS_BACKEND`/`TTS_VOICE` in `.env`. Edge TTS is the fallback path: test it with `podman exec siela-bot python3 -m edge_tts --voice en-IN-NeerjaNeural --text "test" --write-media /tmp/tambola-test.mp3`, then inspect `podman logs siela-bot | grep -i tambola`.
- **LLM features (delulu) fail**: check the `siela-llm` container (`podman logs siela-llm`) and `http://llm:8000/health` per Service checks; vLLM needs the GPU devices and the `llmcache` volume.
- **Migrations fail**: run `./scripts/podman-stack.sh run --rm migrate` and read the output; it retries DB readiness 30 times and honors `MIGRATIONS_DIR` if set.
- **MCP is not running**: it is optional and off by default. Set `MCP_ENABLED=true` in `deploy/podman/.env`, then run `scripts/podman-stack.sh up -d`.
- **MCP unreachable from the host**: it is on the internal `mcp` network by default. Use `compose.mcp.yaml` plus `compose.host.yaml` for `127.0.0.1:8080`, or run the MCP client as a container on `siela_mcp`.
