# Architecture

This document explains how the bot is assembled and where state lives. It is the current architecture reference. `docs/PLAN.md` is a historical design document and does not describe the deployed system.

## Process model

Siela Bot runs as one long-lived Bun process. `apps/bot/src/bot.ts` is the composition root. It creates the Discord client, the command registry, the feature services, the Fastify control API, and the health server.

Automation talks to the control API over the internal `control` network with a bearer token (`MCP_TOKEN`).

```mermaid
flowchart LR
  subgraph BP[Commander process]
    BOT[discord.js client]
    REG[Command registry and feature services]
    API[Control API :3001]
    WORKER[Worker API :3101]
    HEALTH[Health and metrics :3002]
    BOT --> REG
    API --> REG
    WORKER --> REG
  end

  subgraph WP[Voice worker process]
    WBOT[discord.js client<br/>voice only]
    WMUSIC[MusicService]
    WTTS[TtsService]
    WWORKER[Worker API :3101]
    WHEALTH[Health :3002]
    WBOT --> WMUSIC
    WBOT --> WTTS
    WWORKER --> WMUSIC
    WWORKER --> WTTS
  end

  U[Discord users] --> DG[Discord gateway and voice]
  DG <--> BOT
  DG <--> WBOT

  R[Router :3100] --> WORKER
  R --> WWORKER
  R -->|all other routes| API

  REG --> PG[(PostgreSQL 17)]
  REG --> VK[(Valkey 8, optional)]
  REG --> LLM[llama.cpp :8000]
  REG --> TTS[KittenTTS :8000]
  REG --> EXT[YouTube, SoundCloud,<br/>Spotify, LRCLIB, Aladhan]
  REG --> MEM[In-memory state]
  REG --> TMP["/tmp cache and sockets"]

  WMUSIC --> VK
  WTTS --> TTS
```

Only the commander serves the public control API and registers slash commands. Voice workers serve the internal worker API and health endpoints, take no chat input, and run no schedulers. The router is stateless and holds no Discord or database client.

## Command lifecycle

Prefix commands and slash commands share the same registry, guard, and execution path. Component interactions use a hand-written custom-ID router in `bot.ts`.

```mermaid
flowchart TD
  EVENT[Gateway event] --> KIND{Event type}

  KIND -->|MessageCreate| MSG[Ignore bots, DMs, webhooks, other guilds]
  MSG --> ACT[Record activity and run TTS hook]
  ACT --> PARSE[Load prefix and parse message]
  PARSE --> LOOKUP[Registry lookup by name or alias]

  KIND -->|Chat input| SLASH[Resolve member and options]
  SLASH --> LOOKUP

  KIND -->|Component| CID[Custom ID router]
  CID --> HANDLER[Feature-specific handler]

  LOOKUP --> FOUND{Command found?}
  FOUND -->|no| IGNORE[Ignore or react with a throttled marker]
  FOUND -->|yes| GUARD[Admin, NSFW, permissions, bot permissions, cooldown]

  GUARD -->|deny| DENY[Ephemeral denial]
  GUARD -->|allow| EXEC[command.execute]
  EXEC --> POST[Record command and economy award]
  EXEC -->|throws| ERROR[Friendly error or request reference]
```

Component handlers cover `tambola:`, `economy:bj:`, `music:`, `tempvc:`, and `help:`. Queue pagination and confirmation cards use per-message collectors instead of the global component router.

## Boot sequence

The compose stack starts the migration container before the bot container, but short-form `depends_on` does not wait for the one-shot migration to exit. The migration runner retries database readiness. If the bot starts before the schema is ready, restart the bot after `migrate` exits.

```mermaid
sequenceDiagram
  participant Compose
  participant Postgres
  participant Migrate
  participant Bot
  participant Discord

  Compose->>Postgres: start
  Compose->>Migrate: start one-shot
  Compose->>Bot: start after containers are created
  Migrate->>Postgres: retry connection and run migrations
  Bot->>Bot: validate config, open database, build services
  Bot->>Bot: start control API and health server
  Bot->>Discord: login
  Discord-->>Bot: client ready
  Bot->>Bot: bind guild, register commands, reconcile features
```

Guild initialization ensures settings rows, registers slash commands, reconciles temporary voice channels, purges old activity rows, and starts the timer-driven features.

## Persistence map

PostgreSQL is the source of truth for durable state. Valkey is an optional cache and buffer. Active games and cooldown state live in process memory and disappear on restart. Relic auctions and trades are durable: the scheduler resumes and settles them after a restart.

```mermaid
flowchart LR
  BOT[Bot process] --> PG[(PostgreSQL)]
  BOT --> VK[(Valkey)]
  BOT --> MEM[Process memory]
  BOT --> TMP["/tmp"]

  PG --> P1[Guild settings and feature configuration]
  PG --> P2[Social counters, friendship, family, birthdays]
  PG --> P3[Activity, confessions, audit log]
  PG --> P4[Economy accounts, ledger, inventory, premium passes]
  PG --> P5[Relic cards, auctions, bids, vaults, trades]

  VK --> V1[Music queue per node and guild]
  VK --> V2[Friendship delta buffer]
  VK --> V3[Economy balance and leaderboard cache]
  VK --> V4[Fleet session heartbeats, 45s TTL]

  MEM --> M1[Active Tambola games]
  MEM --> M2[Blackjack hands]
  MEM --> M3[Cooldowns and unknown-command notices]

  TMP --> T1[Music cache]
  TMP --> T2[TTS cache]
  TMP --> T3[mpv IPC sockets and FIFOs]
```

The economy ledger is append-only. Every balance change writes a transaction row in the same database transaction as the account update. When Valkey is unavailable, economy reads fall back to PostgreSQL.

## Deployment topology

The production stack contains PostgreSQL, Valkey, llama.cpp, KittenTTS, a one-shot migration container, the commander, and the router. Voice workers and watchtower are optional.

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
```

The commander is attached to `edge`, `data`, and `control`. Workers need `edge` for the Discord gateway and voice, `data` for PostgreSQL and Valkey, and `control` so the router can reach their worker API. The router sits on `control` and `data` only. Watchtower attaches to `edge` and mounts the host Podman socket. Automation reaches the commander through the `bot-control` alias and the fleet through `voice-router`, both on `control`.

See [deploy/podman/README.md](../deploy/podman/README.md) for service configuration and overlays.

## Extension points

To add a command:

1. Add the command definition under `apps/bot/src/commands/`.
2. Register it in `apps/bot/src/commands/index.ts`.
3. Add any service to `Services` and instantiate it in `apps/bot/src/bot.ts`.
4. Route new component custom IDs in `bot.ts`.
5. Add tests and run `bun run typecheck`, `bun run test`, and `bun run build`.

To add durable state, update `packages/db/src/schema.ts`, generate a migration, and update the persistence map in this document.

## Known constraints

- The bot is single-guild by design. It binds to `GUILD_ID` or the only guild it can see and leaves other guilds.
- Context-menu commands are not implemented. The registry supports slash and prefix commands.
- Active Tambola games and blackjack hands are not persisted. A restart cancels them.
- The bot container does not need GPU access. The llama.cpp container runs on CPU.
- Fleet voice-busy checks are per process, not per fleet. Two nodes can be told to join the same channel; the last writer wins.
- Tambola, scheduled events, random VC drops, and activity tracking run on the commander only.
