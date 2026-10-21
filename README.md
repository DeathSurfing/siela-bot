# Siela Bot

A single-guild Discord bot with music, welcome/auto-role, social counters, temporary voice channels, reply-to-translate, a global prefix, and an MCP control server. Deployed with rootless Podman.

## Features

- **Music** — yt-dlp + mpv streaming: SoundCloud works out of the box; YouTube/YouTube Music playlists import into the queue; Spotify links are resolved through oEmbed metadata and searched on SoundCloud. Use `join` to reconnect to your VC, `queue [page]` to inspect, `clearqueue` to empty upcoming tracks, and `nowplaying` (aliases `current`, `currentlyplaying`, `cp`, `np`) to show the current track. Now-playing messages support reactions: `⏯️` pause/resume, `⏪`/`⏩` seek, `⏭️` skip, `⏹️` stop/disconnect, `🔀` shuffle, `🔁` loop.
- **Translation** — self-hosted Hugging Face NLLB-200 (distilled 600M) translates Hindi, Hinglish, Korean, Arabic, Japanese, Chinese, and many other languages to English; no paid API key.
- **Welcomer** — join messages, generated welcome image cards (`welcome card on/off`), optional DMs, optional goodbye messages.
- **Auto-role** — admin-configurable roles with hierarchy and dangerous-permission checks.
- **Ephemeral music queue** — tracks live in memory only; disconnecting or restarting the bot clears the queue.
- **Social** — `slap`, `kiss`, `hug`, `chodu` with PostgreSQL pair counters, stats, leaderboard, and opt-out.
- **Temporary VC** — join-to-create private voice channels with a control panel in the channel's text chat for lock/unlock, rename, limit, kick, ownership transfer, and delete. Empty temp VCs are removed immediately. `jointocreate #voice [template]` (alias `j2c`) auto-creates a **Temporary VCs** category and sets the default `{user}'s VC` template.
- **Prefix** — global single-guild prefix with validation and audit.
- **Hybrid commands** — prefix + slash + context menu + mention prefix.
- **MCP (optional)** — 50+ tools exposed on the Podman `mcp` network via `MCP_URL` and one `MCP_TOKEN`. Off by default; set `MCP_ENABLED=true` to enable.
- **Podman** — `podman compose`-compatible core stack: Postgres, the Hugging Face translator, bot, and a one-shot migrate service. MCP is an optional overlay. The bot image includes yt-dlp and mpv.

## Quickstart

```bash
export DISCORD_TOKEN="..."
./scripts/podman-init.sh
./scripts/podman-stack.sh up -d --build
```

Only `DISCORD_TOKEN` is required. The init script derives the client ID, prints an invite URL, generates the internal Postgres/MCP secrets, and writes a 600-permission `.env`. `GUILD_ID` is auto-detected when the bot is in exactly one guild. MCP is disabled by default; set `MCP_ENABLED=true` in `deploy/podman/.env` (or run `MCP_ENABLED=true ./scripts/podman-stack.sh up -d`) to start it. The wrapper selects `compose.mcp.yaml` only when the flag is on.

## Repository

- `apps/bot` — discord.js bot, feature services, control API, health/metrics.
- `apps/translator` — self-hosted FastAPI + Hugging Face NLLB translation service.
- `apps/mcp` — MCP server (stdio + Streamable HTTP) and tool catalog.
- `packages/shared` — Zod schemas, types, constants, utilities.
- `packages/db` — Drizzle schema, migrations, Postgres client.
- `packages/config` — environment validation.
- `deploy/podman` — compose, Containerfiles, optional host/proxy overrides.
- `docs/PLAN.md` — full architecture, security, and delivery plan.
- `docs/RUNBOOK.md`, `docs/MCP.md`, `docs/THREAT-MODEL.md`.

## Development

```bash
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Node.js 24+ is required. The deployment target uses Podman 5+ with cgroups v2.
