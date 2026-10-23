# Siela Bot

A single-guild Discord bot with music, Tambola, social features, economy, TTS, temporary voice channels, a global prefix, and an MCP control server. Deployed with rootless Podman. Runtime is Bun 1.x.

59 registered commands (58 slash-enabled; `test` is prefix-only). 51 MCP tools.

## Features

- **Music** — yt-dlp + mpv streaming: SoundCloud works out of the box; YouTube/YouTube Music playlists and Spotify playlists/albums import into the queue. Use `join` to reconnect to your VC, `queue [page]` to inspect, `clearqueue` to empty upcoming tracks, `nowplaying` (aliases `current`, `currentlyplaying`, `cp`, `np`) to show the current track, and `lyrics` (or the Lyrics button) to fetch lyrics for the current track from LRCLIB. Now-playing messages include buttons for pause/resume, lyrics, skip, a More select (seek back/forward 10s, shuffle, loop, filters), and stop/disconnect. Filters apply live through mpv without restarting the track.
- **Tambola** — host 90-ball Tambola games with private DM tickets, auto or manual marking, Top/Middle/Bottom Line and Full House claims, a live called board, and runtime TTS calls. One game per guild, 2–20 players, 12-second calls (fast 8s, slow 15s), with auto-marking on by default (toggleable in lobby settings). Tickets cost 25 Siela Coins; auto-marking costs 10 SC per game.
- **Delulu** — `/delulu` generates scenarios using the local vLLM service running `Goekdeniz-Guelmez/Josiefied-Qwen2.5-1.5B-Instruct-abliterated-v3`. Costs 5 Siela Coins (15 SC for NSFW in an NSFW channel). No Hugging Face token required.
- **Economy** — Siela Coins wallet with earn/spend flows, delulu and Tambola pricing above, and premium (2000 SC for 30 days). See `docs/ECONOMY.md`.
- **TTS** — standalone text-to-speech via `/tts on|off` plus in-voice playback. Primary voice is KittenTTS Nano ONNX (voice Bruno) via the local `tts` service, with Edge TTS (`en-IN-NeerjaNeural`) as fallback. See `docs/TTS.md`.
- **Welcomer** — join messages, generated welcome image cards (`welcome card on/off`), optional DMs, optional goodbye messages.
- **Auto-role** — admin-configurable roles with hierarchy and dangerous-permission checks.
- **Persistent music queue** — the upcoming queue is saved in Valkey and restored when the bot next creates a player; `stop` clears it, while `disconnect` preserves it. The current playback position is not resumed. Current, next, and previous tracks are cached locally to reduce stutter and network hiccups.
- **Social** — `slap`, `kiss`, `hug`, `chodu`, `wuzu` with PostgreSQL pair counters, stats, leaderboard, and opt-out; plus a permanent pair-based `lovecalc`, a BTS `bias` command, automatic birthday wishes, **Friendship Levels** (XP and time together with fixed tiers; time is buffered in Valkey before bulk database writes), a locally rendered **family tree** image, and an anonymous **Confession Wall**.
- **Random VC drops** — every 2–6 hours, rarely joins a populated voice channel, plays a short synthetic "faahhh" or pipe-drop sound, and leaves.
- **Scheduled voice events (optional)** — at the selected Delhi prayer time, then +1h and +2h, moves everyone already in voice through `masjid`, `parliament`, and `mandir` channels and plays admin-supplied licensed audio. Disabled by default; requires `EVENT_SCHEDULE_ENABLED=true` and files in `apps/bot/assets/events/`.
- **Temporary VC** — join-to-create private voice channels with a control panel in the channel's text chat for lock/unlock, rename, limit, kick, ownership transfer, and delete. Only the channel owner and admins can kick members. Empty temp VCs are removed immediately. `jointocreate #voice [template]` (alias `j2c`) auto-creates a **Temporary VCs** category and sets the default `{user}'s VC` template.
- **Activity monitoring** — per-member message, command, reaction, and voice-time stats with `activity` and `activetop` (90-day retention).
- **Prefix** — global single-guild prefix with validation and audit.
- **Hybrid commands** — prefix + slash + context menu + mention prefix.
- **MCP (optional)** — 51 tools exposed on the Podman `mcp` network via `MCP_URL` and one `MCP_TOKEN`. Off by default; set `MCP_ENABLED=true` to enable.
- **Podman** — `podman compose`-compatible core stack: Postgres, Valkey, vLLM (`llm`), TTS (`tts`), bot, and a one-shot migrate service. MCP and Caddy are optional overlays. The bot image includes yt-dlp and mpv.

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
- `deploy/podman` — compose, Containerfiles, optional host/proxy overlays.

## Docs

- `docs/ECONOMY.md` — Siela Coins, pricing, premium.
- `docs/TTS.md` — KittenTTS service, voices, fallback, `/tts`.
- `docs/DELULU.md` — vLLM delulu generation and costs.
- `docs/RUNBOOK.md` — deploy, updates, backups, remote Podman.
- `docs/MCP.md` — MCP transports, clients, tool groups.
- `docs/THREAT-MODEL.md` — security boundaries.
- `docs/UI_AUDIT.md` — UI conventions and audit status.
- `docs/TAMBOLA_PLAN.md` — Tambola rules, state, TTS, implementation phases.
- `docs/PLAN.md` — historical planning doc (Draft v0.2), not current architecture. No translation feature was built.
- `.opencode/skills/siela-bot/SKILL.md` — agent-facing repo guide covering architecture, features, development, and deployment.

## Development

```bash
bun install
bun run typecheck
bun run test
bun run build
```

Bun 1.x is required (`packageManager bun@1.4.2`). `pnpm-lock.yaml` is still present because the MCP image uses pnpm/node; it is not the dev workflow. The deployment target uses Podman 5+ with cgroups v2.
