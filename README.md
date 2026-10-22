# Siela Bot

A single-guild Discord bot with music, welcome/auto-role, social counters, temporary voice channels, a global prefix, and an MCP control server. Deployed with rootless Podman.

## Features

- **Music** — yt-dlp + mpv streaming: SoundCloud works out of the box; YouTube/YouTube Music playlists import into the queue; Spotify links are resolved through oEmbed metadata and searched on SoundCloud. Use `join` to reconnect to your VC, `queue [page]` to inspect, `clearqueue` to empty upcoming tracks, and `nowplaying` (aliases `current`, `currentlyplaying`, `cp`, `np`) to show the current track. Now-playing messages include buttons for pause/resume, seek back/forward 10s, skip, stop/disconnect, shuffle, loop, and a filter dropdown for off/bass boost/nightcore/vaporwave.
- **Welcomer** — join messages, generated welcome image cards (`welcome card on/off`), optional DMs, optional goodbye messages.
- **Auto-role** — admin-configurable roles with hierarchy and dangerous-permission checks.
- **Ephemeral music queue** — tracks live in memory only; disconnecting or restarting the bot clears the queue.
- **Social** — `slap`, `kiss`, `hug`, `chodu`, `wuzu` with PostgreSQL pair counters, stats, leaderboard, and opt-out; plus a permanent pair-based `lovecalc`, a BTS `bias` command, automatic birthday wishes, **Friendship Levels** (XP and time together with fixed tiers), and an anonymous **Confession Wall**.
- **Temporary VC** — join-to-create private voice channels with a control panel in the channel's text chat for lock/unlock, rename, limit, kick, ownership transfer, and delete. Only the channel owner and admins can kick members. Empty temp VCs are removed immediately. `jointocreate #voice [template]` (alias `j2c`) auto-creates a **Temporary VCs** category and sets the default `{user}'s VC` template.
- **Activity monitoring** — per-member message, command, reaction, and voice-time stats with `activity` and `activetop` (90-day retention).
- **Delulu** — `/delulu` generates ridiculous bias scenarios using a local llama.cpp service running a 0.6B abliterated Qwen3 GGUF model. No Hugging Face token required.
- **Prefix** — global single-guild prefix with validation and audit.
- **Hybrid commands** — prefix + slash + context menu + mention prefix.
- **MCP (optional)** — 50+ tools exposed on the Podman `mcp` network via `MCP_URL` and one `MCP_TOKEN`. Off by default; set `MCP_ENABLED=true` to enable.
- **Podman** — `podman compose`-compatible core stack: Postgres, bot, and a one-shot migrate service. MCP is an optional overlay. The bot image includes yt-dlp and mpv.

## Quickstart

```bash
export DISCORD_TOKEN="..."
./scripts/podman-init.sh
./scripts/podman-stack.sh up -d --build
```

Only `DISCORD_TOKEN` is required. The init script derives the client ID, prints an invite URL, generates the internal Postgres/MCP secrets, and writes a 600-permission `.env`. `GUILD_ID` is auto-detected when the bot is in exactly one guild. MCP is disabled by default; set `MCP_ENABLED=true` in `deploy/podman/.env` (or run `MCP_ENABLED=true ./scripts/podman-stack.sh up -d`) to start it. The wrapper selects `compose.mcp.yaml` only when the flag is on.

## Repository

- `apps/bot` — discord.js bot, feature services, control API, health/metrics.
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
