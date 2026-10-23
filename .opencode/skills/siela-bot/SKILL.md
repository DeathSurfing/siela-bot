---
name: siela-bot
description: Use when working in, extending, debugging, testing, or deploying the siela-nogseuui-seobeo-bot repository. Covers the Bun/TypeScript monorepo, single-guild discord.js bot, hybrid command framework, music/lyrics/Tambola voice features, PostgreSQL/Drizzle schema, Valkey, control API, MCP server, Podman deployment, and runbook gotchas.
---

# Siela Bot

Single-guild Discord bot with music, social features, temporary voice channels, Tambola, a control API, and an optional MCP server. Deployed with rootless Podman.

## Ground rules

- **One guild only.** The bot binds to `GUILD_ID` or auto-detects the only guild it is in and leaves others.
- **Only `DISCORD_TOKEN` is human-required.** `scripts/podman-init.sh` derives the client ID and generates the Postgres/MCP secrets.
- **Hybrid commands.** Most commands work as prefix, slash, and mention-prefix. Context-menu commands are not implemented.
- **Runtime authorization.** Admin checks use `Manage Guild`, server owner, `BOT_OWNER_ID`, or `ADMIN_ROLE_IDS`; never rely only on slash-command permissions.
- **Optional features degrade gracefully.** Missing Valkey, LLM, MCP, music binaries, TTS, or event audio must not take down the bot.
- **No secrets in the repo.** `deploy/podman/.env` is generated and must stay untracked.

## Architecture

```text
Discord users
  │ prefix / slash / mention
  ▼
apps/bot (discord.js)
  ├─ command registry + prefix/slash contexts + cooldowns
  ├─ feature services
  ├─ music/Tambola voice + yt-dlp/mpv/ffmpeg
  ├─ Fastify control API :3001
  ├─ Fastify health/metrics :3002
  ├─ PostgreSQL via Drizzle
  ├─ Valkey via Bun Redis client
  ├─ optional local vLLM (delulu)
  └─ optional local KittenTTS (tts)
        ▲
apps/mcp (optional, no Discord/DB credentials)
  └─ typed MCP tools → Bearer MCP_TOKEN → control API
```

## Repository map

| Path | Purpose |
|---|---|
| `apps/bot/src/index.ts` | Process entrypoint: config, DB, logger, signals. |
| `apps/bot/src/bot.ts` | Bot lifecycle, event wiring, interaction routing, command registration, service composition. |
| `apps/bot/src/commands/` | Command definitions grouped by category. Register every new command in `commands/index.ts`. |
| `apps/bot/src/framework/` | Command interface, registry, cooldowns, prefix/slash contexts, permissions. |
| `apps/bot/src/features/` | Feature services and UI builders. |
| `apps/bot/src/control/` | Control API and health/metrics servers. |
| `apps/bot/src/lib/` | Logger and error classes. |
| `apps/bot/assets/` | SFX and scheduled-event audio. Event audio is gitignored/server-only. |
| `apps/mcp/src/` | MCP server (stdio + Streamable HTTP) and control-client tools. |
| `packages/config` | Zod environment validation. |
| `packages/db` | Drizzle schema, Postgres client, migrations. |
| `packages/shared` | Shared types, Zod schemas, constants, utilities. |
| `deploy/podman` | Compose stack, Containerfiles, optional MCP/host/proxy overlays. |
| `scripts/` | Podman init, stack wrapper, compose smoke test. |
| `docs/` | Architecture plan, runbook, MCP docs, threat model, UI audit, Tambola plan. |

## Command framework

`apps/bot/src/framework/types.ts` defines:

- `Command`: name, aliases, category, description, usage, examples, admin-only/NSFW flags, cooldowns, required permissions, optional slash builder, `execute`.
- `CommandContext`: unified prefix/slash context with `reply`, `edit`, `followUp`, `defer`.
- `Services`: all feature services, wired in `bot.ts`.

Flow:

1. Prefix messages are parsed in `onMessage`; slash commands in `onChatInput`.
2. Cooldowns and permissions run in `bot.guard`.
3. `command.execute(ctx)` runs.
4. Component interactions are routed by custom-ID prefix in `bot.onInteraction`.
5. Errors:
   - Prefix and slash commands use `handleCommandError`.
   - Use `UserError`/`ServiceUnavailableError` for friendly messages.
   - Unexpected errors get a request reference.

Categories: `music`, `social`, `voice`, `utility`, `admin`.

## Feature map

| Feature | Main files | Notes |
|---|---|---|
| Music | `features/music.ts`, `features/music-ui.ts`, `commands/music/music.ts` | yt-dlp + mpv (ffmpeg fallback), queue, filters, Spotify, cache, now-playing V2 card. |
| Lyrics | `features/lyrics.ts`, `features/lyrics-ui.ts` | LRCLIB, `/lyrics` and now-playing button, in-memory cache, long lyrics attach `.txt`. |
| Tambola | `features/tambola/*`, `features/tambola-ui.ts`, `commands/social/tambola.ts` | 90-ball game, DM tickets, auto/manual marking, claims, KittenTTS calls with Edge TTS fallback, lobby settings. Ticket 25 SC, automark 10 SC. |
| Welcome | `features/welcome.ts`, `features/welcomeCard.ts`, `commands/admin/welcome.ts` | Join/goodbye messages, optional image card/DM. |
| Auto-role | `features/autorole.ts`, `commands/admin/autorole.ts` | Safe role validation, hierarchy, sync preview/apply. |
| Temp VC | `features/tempvc.ts`, `commands/voice/vc.ts`, `commands/admin/tempvc.ts`, `commands/admin/jointocreate.ts` | Join-to-create, owner panel, lock/rename/limit/kick/transfer/delete, reconcile. |
| Social counters | `features/social.ts`, `features/counters.ts`, `commands/social/social.ts` | `slap`, `kiss`, `hug`, `chodu`, `wuzu`, opt-out-aware. |
| Love / bias | `features/love.ts`, `features/bias.ts`, `commands/social/love.ts`, `commands/social/bias.ts` | Stable pair score; BTS bias. |
| Friendship | `features/friendship.ts`, `commands/social/friendship.ts` | XP + co-presence seconds, Valkey buffer, 30s DB flush. |
| Family | `features/family.ts`, `features/familyCard.ts`, `commands/social/family.ts` | Marriages/children, editorial canvas family tree. |
| Confessions | `features/confession.ts`, `commands/social/confess.ts`, `commands/admin/confession.ts` | Anonymous wall, moderation. |
| Birthdays | `features/birthday.ts`, `commands/utility/birthday.ts` | Daily scheduler, optional wishes. |
| Activity | `features/activity.ts`, `commands/utility/activity.ts` | Message/command/reaction/voice stats, retention. |
| Delulu | `features/delulu.ts`, `commands/social/delulu.ts` | Local vLLM (`Goekdeniz-Guelmez/Josiefied-Qwen2.5-1.5B-Instruct-abliterated-v3`); 5 SC, 15 SC for NSFW. No HF token required. |
| Random VC | `features/randomVc.ts` | Rare 2–6h drop, synthetic SFX, skips when voice is busy. |
| Economy | `features/economy.ts`, economy commands | Siela Coins wallet; delulu 5/15 SC, tambola ticket 25 / automark 10 SC, premium 2000 SC/30d. See `docs/ECONOMY.md`. |
| TTS | `features/tts.ts`, `/tts on\|off` | Standalone TTS via local KittenTTS Nano ONNX (Bruno), Edge TTS fallback. See `docs/TTS.md`. |
| Scheduled events | `features/scheduledEvents.ts`, `commands/utility/test.ts` | Aladhan Delhi prayer, three phases, admin-supplied audio. |
| Privacy/audit | `features/privacy.ts`, `features/audit.ts`, `commands/utility/privacy.ts` | Data deletion, audit log. |
| Control API | `control/server.ts` | Bearer `MCP_TOKEN`, typed routes, audit for mutations. |
| Health | `control/health.ts` | `/healthz`, `/readyz`, `/metrics`. |

## Music

- Backend default `mpv`; `MUSIC_BACKEND=ffmpeg` supported.
- `yt-dlp` resolves searches/URLs. SoundCloud is the zero-token default; YouTube fallback exists.
- Spotify:
  - Track links use public oEmbed metadata + search.
  - Playlists/albums use Spotify's public embed `__NEXT_DATA__` (first 50 tracks), then YouTube search.
  - No Spotify credentials required.
- Queue is in-memory, persisted to Valkey per guild.
  - `stop` clears the stored queue.
  - `disconnect` preserves it.
  - Current playback position is not resumed.
- Local cache keeps current/next/previous tracks under `/tmp/siela-music-cache` (cap ~250 MB), audio bitrate capped at 312 kbps.
- Filters apply live through mpv IPC without restarting the track.
- Now-playing V2 card buttons: pause/resume, lyrics, seek ±10s, skip, stop/disconnect, shuffle, loop, filter select.
- `/lyrics` fetches LRCLIB; `My ticket`-style long text uses a `.txt` attachment.

## Tambola

- 90-ball Tambola, **one active game per guild**, 2–20 players.
- 3×9 ticket, 15 numbers, 5 per row, 1–3 per column.
- Tickets are sent by **DM**; ephemeral fallback when DMs are closed.
- **Auto-marking is ON by default.** The host can turn it off in lobby settings.
- Claims: Top Line, Middle Line, Bottom Line, Full House. First valid claim wins; Full House ends the game.
- Lobby **Settings** button and `/tambola settings`:
  - Toggle auto-marking.
  - Pick the TTS voice channel or Text only.
  - Settings are lobby-only.
- Calls:
  - Default 12s; host can choose fast 8s or slow 15s.
  - Host can call manually (2s throttle), pause/resume, end.
- TTS:
  - Primary: local KittenTTS Nano ONNX service (`tts`, voice Bruno); Edge TTS (`en-IN-NeerjaNeural`, rate `-5%`) is the fallback.
  - `edge-tts==7.3.1` is installed in the bot image.
  - MP3s cached in `/tmp/siela-tambola-tts`, played via `@discordjs/voice` + ffmpeg.
  - Bingo classics + generic hype flavours; text-only fallback on failure.
- Voice coordination:
  - Tambola joins the selected voice channel when the lobby opens.
  - It stops music and locks the music voice (`MusicService.voiceLocks`).
  - Random VC and scheduled events skip while Tambola is using voice.
  - Music commands are blocked while the lock is active.
- Active games are in memory only; a restart cancels them and stale buttons report “no longer active.”
- Stats/leaderboards are deferred; there are no Tambola tables yet.

## Database

Postgres 17 + Drizzle. Schema: `packages/db/src/schema.ts`. Migrations: `packages/db/drizzle/`.

Tables:

- Settings: `guild_settings`, `welcome_settings`, `autorole_settings`, `tempvc_settings`, `music_settings`
- Social: `interaction_counters`, `interaction_optouts`, `user_birthdays`, `user_biases`, `friendship_levels`
- Voice/activity: `temp_voice_channels`, `member_activity`
- Content: `confessions`, `family_marriages`, `family_children`
- Operations: `audit_log`

Migration commands:

```bash
bun run db:generate   # generate a migration after schema changes
bun run db:migrate    # run migrations with DATABASE_URL
```

The compose stack also runs a one-shot `migrate` service before the bot starts.

## Configuration

Config is validated by `packages/config/src/index.ts`; `*_FILE` variants read secrets from files.

Required:

- `DISCORD_TOKEN`
- `DATABASE_URL`
- `MCP_TOKEN` (generated by init)

Common optional:

- `GUILD_ID`, `DISCORD_CLIENT_ID`
- `MUSIC_BACKEND`, `YTDLP_PATH`, `MPV_PATH`, `FFMPEG_PATH`
- `CONTROL_API_HOST/PORT`, `HEALTH_HOST/PORT`
- `DEFAULT_PREFIX`, `ADMIN_ROLE_IDS`, `BOT_OWNER_ID`
- `VALKEY_URL`, `LLM_URL`, `HF_TOKEN`
- `EVENT_SCHEDULE_ENABLED`, `EVENT_PRAYER`
- `LOG_LEVEL`, `AUDIT_RETENTION_DAYS`, `TZ`

Current deployed server uses `EVENT_SCHEDULE_ENABLED=true` and `EVENT_PRAYER=Dhuhr`; event audio lives only on the server.

## Development workflow

Bun 1.x (`packageManager bun@1.4.2`).

```bash
bun install
bun run typecheck
bun run test
bun run build
```

Useful:

```bash
bun run --filter @siela/bot test
bun run --cwd apps/bot dev
bun run --cwd apps/mcp dev
```

Conventions:

- ESM + TypeScript; imports use `.js` extensions.
- Prefer `UserError` for user-facing failures.
- Use `features/ui.ts` helpers and Components V2 (`MessageFlags.IsComponentsV2`) for cards.
- Keep custom IDs namespaced (`music:`, `tambola:`, `tempvc:`, `help:`) and route them in `bot.ts`.
- Add new services to `Services` and instantiate in `bot.ts`.
- Register commands in `commands/index.ts`.
- Add cleanup for timers, voice connections, and collectors on shutdown.
- Audit admin/MCP mutations with `AuditService`.
- Tests use Vitest; colocate `*.test.ts`.

## Deployment

### Standard first deploy

```bash
git clone https://github.com/DeathSurfing/siela-nogseuui-seobeo-bot.git
cd siela-nogseuui-seobeo-bot

export DISCORD_TOKEN="..."
./scripts/podman-init.sh          # derives client ID, generates secrets, writes deploy/podman/.env (600)
./scripts/podman-stack.sh up -d --build
podman ps --format '{{.Names}}\t{{.Status}}'
```

The init script prints the invite URL. MCP is off by default; set `MCP_ENABLED=true` in `.env` or prefix the wrapper command.

### Stack

`deploy/podman/compose.yaml`:

- `postgres` — Postgres 17, `pgdata` volume.
- `valkey` — Valkey 8, `valkeydata` volume.
- `llm` — vLLM server (`Goekdeniz-Guelmez/Josiefied-Qwen2.5-1.5B-Instruct-abliterated-v3`) for delulu, `llmcache` volume.
- `tts` — KittenTTS Nano ONNX service (voice Bruno), Edge TTS fallback in bot.
- `migrate` — one-shot `node dist/scripts/migrate.js`.
- `bot` — Discord bot + control API + health/metrics.

Bot container is read-only with `/tmp` tmpfs, drops all caps, and includes ffmpeg, mpv, python3, yt-dlp, edge-tts, fonts, and canvas runtime.

Optional overlays:

- `compose.mcp.yaml` — MCP server on internal `mcp` network.
- `compose.host.yaml` — publish MCP on `127.0.0.1:8080`.
- `compose.proxy.yaml` — Caddy TLS front door.

### Updates

```bash
git pull --ff-only
podman compose -p siela -f deploy/podman/compose.yaml build
podman compose -p siela -f deploy/podman/compose.yaml up -d --force-recreate bot
```

Migrations run when the `migrate` service runs. If needed:

```bash
podman compose -p siela -f deploy/podman/compose.yaml run --rm migrate
```

### Current maintainer server

The remote Podman host is documented in `docs/RUNBOOK.md`. On that host, image builds may need host networking because `/dev/net/tun` is unavailable:

```bash
cd /root/siela-nogseuui-seobeo-bot
git pull --ff-only
podman build --network=host -f deploy/podman/Containerfile.bot -t localhost/siela-bot:latest .
podman compose -p siela -f deploy/podman/compose.yaml up -d --force-recreate bot
podman logs --tail 20 siela-bot
podman ps --format '{{.Names}} {{.Status}}' | grep siela-bot
```

Verify:

- Logs show `guild commands registered` with the expected count.
- `podman ps` shows `siela-bot` as healthy.
- `podman healthcheck run siela-bot`.
- Health endpoints inside the container: `http://127.0.0.1:3002/healthz`, `/readyz`, `/metrics`.

### Scheduled-event audio

Server-only, gitignored under `apps/bot/assets/events/`:

- `azan.ogg` → `masjid`
- `anthem.ogg` → `parliament`
- `hanuman-chalisa.ogg` → `mandir`

Supported extensions: `.ogg`, `.mp3`, `.wav`, `.m4a`, `.flac`. See `apps/bot/assets/events/README.md`. The owner-only prefix command `!test azan|anthem|hanumanchalisa` runs the full workflow; `test` is restricted to user ID `197768227936403458`.

## Control API and MCP

Control API (`apps/bot/src/control/server.ts`):

- Listens on `CONTROL_API_PORT` (default 3001), internal network.
- Requires `Authorization: Bearer <MCP_TOKEN>`.
- Routes include status, commands, prefix, welcome, autorole, tempvc, music, counters, audit, message send, privacy delete.
- Mutations are audited.

MCP (`apps/mcp`):

- Separate optional process with no Discord token and no DB credentials.
- Transports: stdio, HTTP on `siela_mcp`, optional host/TLS overlays.
- Destructive tools require `confirm: true`.
- See `docs/MCP.md`.

## Common operations

```bash
# logs
./scripts/podman-stack.sh logs -f bot
podman logs --since 1h siela-bot | grep -iE 'error|warn|tambola|music'

# restart
podman restart siela-bot

# health
podman healthcheck run siela-bot

# stop preserving volumes
podman compose -p siela -f deploy/podman/compose.yaml down

# destroy everything
podman compose -p siela -f deploy/podman/compose.yaml down -v
```

Backups:

```bash
podman exec siela-postgres pg_dump -U siela -Fc siela \
  | gzip > "/var/backups/siela/siela-$(date +%F).dump.gz"
```

## Troubleshooting

- **Invalid environment**: check `deploy/podman/.env`; `DISCORD_TOKEN` and generated secrets must be present. Use `scripts/podman-init.sh`.
- **Bot in wrong/extra guild**: set `GUILD_ID`; the bot leaves unbound guilds.
- **Music silent**: check `podman exec siela-bot yt-dlp --version` and `mpv --version`; verify no Tambola game is locking voice.
- **Tambola TTS silent**:
  - Check the lobby card `TTS` line.
  - Ensure the bot has `Connect` and `Speak` in the selected voice channel.
  - Check the KittenTTS service first: `podman ps | grep siela-tts`, `podman logs --tail 20 siela-tts`, verify `TTS_SERVICE_URL` (default `http://tts:8000`).
  - Edge TTS fallback needs outbound network access. Test: `podman exec siela-bot python3 -m edge_tts --voice en-IN-NeerjaNeural --text "test" --write-media /tmp/tambola-test.mp3`.
  - Grep logs for `tambola`.
- **Tambola TTS and music conflict**: a Tambola game stops and locks music. Finish/end the game or use Text only in lobby settings.
- **Random VC or prayer event skipped**: expected while Tambola is active or music voice is locked.
- **Slash command says “Something went wrong”**: check logs; `UserError`s now return friendly messages. If the bot restarted, active Tambola games are gone.
- **MCP not running**: set `MCP_ENABLED=true`, then `./scripts/podman-stack.sh up -d`.
- **MCP unreachable from host**: use `compose.host.yaml` or the Caddy overlay; MCP is internal by default.
- **Build fails on current server**: use `podman build --network=host`.
- **Read-only container write failure**: write only to `/tmp` (tmpfs) or a mounted volume.

## Change checklist

1. Locate the feature in `features/`, its command in `commands/`, and UI in a `*-ui.ts`.
2. Add the service to `Services` and instantiate/wire it in `bot.ts`.
3. Register the command in `commands/index.ts`.
4. Route new component custom IDs in `bot.ts`.
5. Add DB migration + schema changes if persistence is needed.
6. Add/update unit tests; run `typecheck`, `test`, `build`.
7. Deploy with Podman; verify command count, health, and logs.
8. Update `README.md` and relevant `docs/` for user-visible behavior.

## Key docs

- `README.md` and `GET_STARTED.md` — project overview and first-run setup.
- `docs/ARCHITECTURE.md` — process model, command lifecycle, boot order, persistence, deployment diagrams.
- `docs/PLAN.md` — historical planning doc (Draft v0.2), not current architecture.
- `docs/ECONOMY.md` — Siela Coins, pricing, premium.
- `docs/TTS.md` — KittenTTS service, voices, fallback, `/tts`.
- `docs/DELULU.md` — vLLM delulu generation and costs.
- `docs/RUNBOOK.md` — deploy, updates, backups, remote Podman, troubleshooting.
- `docs/MCP.md` — MCP transports, clients, tool groups.
- `docs/THREAT-MODEL.md` — security boundaries.
- `docs/UI_AUDIT.md` — UI conventions and audit status.
- `docs/TAMBOLA_PLAN.md` — Tambola rules, state, TTS, implementation phases.
- `deploy/podman/README.md` — compose stack and overlays.
