# Voice fleet (N bots, one control entrypoint)

Discord allows one voice connection per bot per guild. To play in N voice
channels at once, run N bot processes — one commander plus N-1 voice
workers — and drive them through the router as if they were one bot.

## Topology

```mermaid
flowchart LR
  OP[Operator / automation] -->|Bearer MCP_TOKEN| R[router :3100]
  R -->|/internal/*| C[commander<br/>siela-bot]
  R -->|/internal/*| W1[voice-1<br/>siela-voice-1]
  R -->|/internal/*| WN[voice-N]
  C --- PG[(PostgreSQL)]
  C --- VK[(Valkey)]
  W1 --- PG
  W1 --- VK
```

- **Commander** (`NODE_ROLE=commander`, default): the existing bot. Owns
  slash/prefix commands, DB writes that matter, Tambola, scheduled events,
  the public control API `:3001`, and its own voice connection.
- **Voice workers** (`NODE_ROLE=voice`, `NODE_ID=voice-<i>`): same image,
  own `DISCORD_TOKEN`. They ignore text commands and interactions, skip
  schedulers, and serve only the internal worker API `:3101` plus health.
- **Router** (`apps/router`, `siela-router`): stateless gateway. Music
  routes require `nodeId` and fan out to that node's `/internal/music/*`;
  every other `/v1/*` route proxies to the commander unchanged.

Each node keeps an independent music queue. Queues persist in Valkey under
`siela:music:queue:{node}:{guild}`, so workers sharing Valkey never collide.

## Setup

1. Create one Discord application per node (commander + N workers) and
   invite every bot to the guild with the same permissions.
2. Copy the per-node env and fill in each worker token. `MCP_TOKEN`,
   `DATABASE_URL`, and `GUILD_ID` must match the main `.env`:

   ```bash
   cp deploy/podman/.env.voice.example deploy/podman/.env.voice-1
   cp deploy/podman/.env.voice.example deploy/podman/.env.voice-2
   # ... one file per worker
   ```

3. Generate the worker overlay and add the router's node list to `.env`:

   ```bash
   ./scripts/make-voice-overlay.sh 2
   # add the printed NODES= line to deploy/podman/.env
   ```

4. Deploy:

   ```bash
   ./scripts/podman-stack.sh up -d --build
   ```

`scripts/podman-stack.sh` includes the generated overlay automatically when
`deploy/podman/compose.voice.generated.yaml` exists. To go back to one bot,
delete the overlay and the `.env.voice-*` files and restart.

## Routing contract

Point music automation at the router (`http://voice-router:3100` on the
control network), not at individual nodes:

- `GET /v1/music/nodes` — configured node IDs.
- `GET /v1/music/state-all` — per-node playback state (`ok: false` entries
  carry the node error instead of failing the whole call).
- `POST /v1/music/<op>` with `{"nodeId": "voice-1", ...}` — `join`, `play`,
  `pause`, `resume`, `skip`, `stop`, `volume`, `seek`, `loop`, `shuffle`,
  `remove`, `clear`, `move`, `jump`, `autoplay`, `filters`, `disconnect`.
  `play` allows a 5-minute upstream timeout (large playlist resolves).
- Any other `/v1/*` — proxied to the commander as-is.

Discord `!music`/`/music` commands always drive the commander's queue in the
author's channel. Cross-node control from chat is not implemented; use the
router for that.

## Known limitations

- Tambola, scheduled prayer events, random VC drops, and activity/leveling
  awards run on the commander only. The commander's schedulers move whoever
  is in voice, regardless of which node plays there.
- Voice-busy checks (`isVoiceBusy`, music voice locks) are per-process, not
  per-fleet. Two nodes can be told to join channels at the same time; the
  last writer wins per channel.
- All nodes share one guild (`GUILD_ID`). Multi-guild fleets are out of scope.

## Troubleshooting

- `up -d` hangs after an image rebuild: `podman-compose` waits on the
  one-shot `migrate` container, which never reaches "running". The
  migrations themselves already exited 0 — start the long-lived services
  with `./scripts/podman-stack.sh up -d --no-deps` instead.
- `Error: ... depends on container ... not found in input list`: stale
  dependency metadata from an interrupted compose run. Remove the stuck
  `Created` container (`podman rm siela-router`) and run `up` again.
