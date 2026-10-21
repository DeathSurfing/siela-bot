# Siela Bot

A single-guild Discord bot with music, welcome/auto-role, social counters, temporary voice channels, reply-to-translate, a global prefix, and an MCP control server. Deployed with rootless Podman.

## Features

- **Music** — Lavalink 4 + LavaSrc: SoundCloud streaming with zero tokens; optional Spotify search via `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET`; no YouTube.
- **Translation** — self-hosted LibreTranslate; no paid API key.
- **Welcomer** — join messages, optional DMs, optional goodbye messages.
- **Auto-role** — safe role assignment on join with hierarchy and dangerous-permission checks.
- **Social** — `slap`, `kiss`, `hug`, `chodu` with PostgreSQL pair counters, stats, leaderboard, and opt-out.
- **Temporary VC** — join-to-create private voice channels with lock/permit/deny/disconnect/claim/transfer.
- **Prefix** — global single-guild prefix with validation and audit.
- **Hybrid commands** — prefix + slash + context menu + mention prefix.
- **MCP** — 50+ tools exposed on the Podman `mcp` network via `MCP_URL` and one `MCP_TOKEN`.
- **Podman** — `podman compose`-compatible stack: Postgres, Lavalink, LibreTranslate, bot, MCP, and a one-shot migrate service.

## Quickstart

```bash
export DISCORD_TOKEN="..."
./scripts/podman-init.sh
podman compose -p siela -f deploy/podman/compose.yaml up -d --build
podman compose -p siela -f deploy/podman/compose.yaml run --rm migrate
```

Only `DISCORD_TOKEN` is required. The init script derives the client ID, prints an invite URL, generates the internal Postgres/Lavalink/MCP secrets, and writes a 600-permission `.env`. `GUILD_ID` is auto-detected when the bot is in exactly one guild.

## Repository

- `apps/bot` — discord.js bot, feature services, control API, health/metrics.
- `apps/mcp` — MCP server (stdio + Streamable HTTP) and tool catalog.
- `packages/shared` — Zod schemas, types, constants, utilities.
- `packages/db` — Drizzle schema, migrations, Postgres client.
- `packages/config` — environment validation.
- `deploy/podman` — compose, Containerfiles, Lavalink config, optional host/proxy overrides.
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
