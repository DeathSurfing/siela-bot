# Tambola Game Mode — Plan

## Resolved decisions

| Decision | Choice |
|---|---|
| Marking | Auto-marking is on by default and host-toggleable in lobby settings; players can also buy per-player auto-mark (applies to all of their tickets), which re-enables it for them individually |
| Active games | One per guild |
| Winning patterns | Top Line, Middle Line, Bottom Line, Full House |
| Stats/leaderboard | Deferred to a later phase |
| Host | Can play too |
| Calls | Auto-call every 12 seconds by default; fast 8s and slow 15s options; manual host calls |
| Tickets | Sent by DM, with an ephemeral fallback |
| TTS | KittenTTS service primary (KittenML/kitten-tts-nano-0.8, Bruno), Edge TTS local fallback, bingo classics |
| Players | 2–20 per game |
| Mid-game joins/leaves | Not allowed |

## Goal

Add a 90-ball Tambola/Housie game mode that runs inside Discord:

- A host opens a lobby and starts a game.
- Players join and receive a private ticket by DM.
- The bot calls numbers every 12 seconds by default (fast 8s, slow 15s) and announces them in voice with TTS.
- Players manually mark called numbers on their tickets.
- Players claim Top Line, Middle Line, Bottom Line, or Full House.
- The bot validates every claim server-side.
- Full House ends the game.

## Player flow

1. Host runs `/tambola host`.
2. Bot posts a lobby card with **Join**, **Leave**, **Start**, **Settings**, and **Rules** buttons.
3. Players join. Each player gets their ticket by DM.
4. Host starts when at least two players have joined.
5. The bot joins the selected voice channel when the lobby opens, then posts the live game card and begins calling when the host starts.
6. Every 12 seconds by default, the bot:
   - Calls a number from the shuffled 1–90 deck.
   - Announces it with TTS.
   - Updates the live card with the last call and called board.
7. With auto-marking on, called numbers are marked automatically. With it off, players open their DM ticket and tap the called number to mark it.
8. Players claim a pattern from the claim select on their ticket or the game card.
9. The bot validates the claim and updates the game card.
10. Full House ends the game; the final card lists the winners.

## Host flow

- **Start**: host only, at least 2 players.
- **Call next**: host only, manual call; 2-second throttle.
- **Pause/Resume**: host only; pauses auto-calls.
- **End**: host or admin, with a confirmation card.
- **Voice**: `/tambola host` can take a voice channel. If omitted, the host's current voice channel is used. If neither is available, the game runs text-only.
- If the host leaves the guild before the game starts, cancel the lobby.
- If the host leaves after the game starts, transfer host to the first remaining player; end if nobody remains.
- If the channel is deleted, cancel the game and stop timers.

## Game rules

### Ticket generation

- Each ticket is a 3×9 grid.
- Exactly 5 numbers per row.
- Each column contains 1–3 numbers.
- Column ranges: `1–9`, `10–19`, `20–29`, `30–39`, `40–49`, `50–59`, `60–69`, `70–79`, `80–90`.
- Numbers in each column are sorted ascending.
- No duplicate numbers.
- Tickets are generated server-side with `crypto.randomInt` and a rejection-sampled row/column layout.

### Calling

- A shuffled deck contains each number from 1 to 90 exactly once.
- Each call removes one number from the deck and adds it to `calledNumbers`.
- The game ends when Full House is claimed or all 90 numbers have been called.
- Auto-call interval: 12 seconds by default; the host can choose fast (8s) or slow (15s).
- Pausing stops the timer. Resuming continues from the next call.
- Manual calls are allowed while paused.
- Manual calls are throttled to one every 2 seconds.

### Marking

- Auto-marking is on by default. When enabled, called numbers are automatically marked on every ticket and players only need to claim.
- The host can turn auto-marking off in the lobby settings.
- Separately, a player can buy per-player auto-mark (10 SC, applies to all of that player's tickets), which re-enables auto-marking for them even when the global setting is off. Both mechanisms coexist.
- When auto-marking is off, players mark their own numbers.
- A player may only mark a number that:
  - Exists on their ticket.
  - Has already been called.
  - Has not already been marked.
- Marking an uncalled number returns a private error.
- Marking does not happen automatically when auto-marking is off, even if the number is called.
- Players can mark numbers while the game is paused.
- Marks are permanent for the game.
- Late marking is allowed; a player can mark a called number at any time before claiming.

### Claims

| Pattern | Validation |
|---|---|
| Top Line | All 5 numbers in row 1 are marked |
| Middle Line | All 5 numbers in row 2 are marked |
| Bottom Line | All 5 numbers in row 3 are marked |
| Full House | All 15 numbers are marked |

Rules:

- First valid claim per pattern wins.
- A player may win multiple patterns.
- A rejected claim does not consume the pattern.
- Claiming an already-claimed pattern returns a friendly error.
- Claims are allowed while paused.
- Claims after the game has ended are rejected.
- If a number was called but not marked, the claim is rejected with “Mark all numbers in that line first.”
- If the required numbers have not all been called, the claim is rejected with “That line is not complete yet.”
- Full House can be claimed without claiming the three lines first.
- Full House ends the game.

## Commands

Primary command: `/tambola` with subcommands, plus prefix equivalents.

| Command | Who | Purpose |
|---|---|---|
| `/tambola host [max_players] [voice]` | Anyone | Open a lobby |
| `/tambola join` | Anyone | Join the lobby |
| `/tambola leave` | Players | Leave before start |
| `/tambola start` | Host | Start the game |
| `/tambola ticket` | Players | Resend the private ticket |
| `/tambola call` | Host | Call the next number manually |
| `/tambola pause` | Host | Pause auto-calls |
| `/tambola resume` | Host | Resume auto-calls |
| `/tambola end` | Host/admin | End with confirmation |
| `/tambola status` | Anyone | Show current game summary |
| `/tambola rules` | Anyone | Show rules |

Aliases: `housie`, `tambola`.

Stats, leaderboards, and game history are deferred.

## Discord UI

### Lobby card

```text
## ♬ Tambola · Lobby
Host · @user
Players 3/20 · Auto-call 12s
Voice · #General
1. @a
2. @b
3. @c
-# Tickets are sent by DM. Join before the host starts.

[ Join ] [ Leave ] [ Start ] [ Rules ]
```

If no voice channel is available, `Voice · Text only`.

### Live game card

```text
## ♬ Tambola · Live
**Last call** · 42
**Called** · 12/90
**Next call** · 12s

**Called board**
01 · 03 · · 06 · · · 10
· 12 · · 15 · · · 19 20
...
```

The called board is a compact 10-column grid; called numbers are shown, uncalled slots are `·`.

```text
**Claims**
○ Top Line
○ Middle Line
○ Bottom Line
○ Full House

**Players** · 3
[ Claim ] [ My ticket ]
[ Call next ] [ Pause ] [ End ]   (host row)
```

### Ticket DM

The ticket is sent by DM on join:

```text
## ♬ Your Tambola ticket
Game `ABC123` · 3/15 marked

[ 12 ] [ 34 ] [ 56 ] [ 78 ] [ 90 ]
[ 15 ] [ 37 ] [ 59 ] [ 81 ] [ 11 ]
[ 33 ] [ 55 ] [ 77 ] [ 89 ] [ 22 ]
[ Claim a pattern ▼ ]
[ Refresh ]
```

Details:

- The 15 number buttons are grouped by ticket row.
- Clicking a number validates that it is on the ticket and has been called.
- Marked buttons are disabled and use the success style.
- The claim select contains the four patterns.
- **Refresh** re-renders the ticket with current marks and called state.
- The same ticket payload is used for the ephemeral fallback.

### DM fallback

- If the DM fails because the user has DMs closed:
  - For slash/button joins: send an ephemeral ticket.
  - For prefix joins: reply with “I couldn't DM your ticket. Use `/tambola ticket` to open it privately.”
- `/tambola ticket` and the **My ticket** button try DM first, then fall back to an ephemeral ticket.

## TTS

### Approach

Use **runtime TTS** with the KittenTTS service as primary and Edge TTS as local fallback.

- Primary: KittenTTS Nano ONNX (`KittenML/kitten-tts-nano-0.8`), voice `Bruno`, speed `1.0`, served by `deploy/podman/tts` (FastAPI: `/healthz`, `/synthesize`, `/synthesize-stream`). Bot env: `TTS_SERVICE_URL=http://tts:8000`, `TTS_STREAM=true`. TambolaVoice prefers remote streaming, then remote buffered, then the local backend.
- Local fallback: `TTS_BACKEND=edge` default (`edge-tts` CLI, voice `en-IN-NeerjaNeural`, rate `-5%`); `kitten`/`kitten-mini` daemon scripts via `TTS_PYTHON` + `KITTEN_TTS_SCRIPT`.
- No API key or paid account required.
- The bot container already has Python 3 and pip; add `edge-tts` to the runtime image for the fallback path.
- Generated clips are cached on disk by phrase hash (`/tmp/siela-tambola-tts`, SHA-1 keyed, max 300 files).
- The bot uses `ffmpeg` to play the cached MP3 through a dedicated Tambola audio player.
- If the KittenTTS service and the local fallback are unavailable, the game continues text-only.

### Runtime flow

For each number call:

1. Build the phrase: `Number 42. Answer to everything.`
2. Check the cache for that exact voice + phrase.
3. If missing, synthesize via the KittenTTS service (or the local fallback) and write the clip to the cache.
4. Play the clip in the Tambola voice channel.
5. Delete or evict old cache files when the cache grows too large.

One request per call is enough; remote synthesis takes roughly 1–2 seconds for a short phrase, well inside the 12-second interval.

### TTS service

`TambolaVoice` responsibilities:

- Join/leave the selected voice channel.
- Own a dedicated `AudioPlayer`.
- Synthesize phrases via the KittenTTS service (streaming preferred), falling back to remote buffered synthesis, then the local backend (Edge TTS default).
- Cache generated audio.
- Queue/play intro, call, claim, pause, resume, and Full House cues.
- Enforce a synthesis timeout and fall back to text-only.
- Never block the game loop; TTS runs asynchronously after the card updates.

Example call:

```text
Number 13. Unlucky for some.
```

Example generic flavour:

```text
Number 41. Eyes down, mark it!
```

### Bingo classics

Use the standard bingo-call flavour for numbers where one exists:

| Number | Call |
|---|---|
| 1 | Kelly's eye |
| 2 | One little duck |
| 3 | Cup of tea |
| 4 | Knock at the door |
| 5 | Man alive |
| 6 | Half a dozen |
| 7 | Lucky seven |
| 8 | Garden gate |
| 9 | Doctor's orders |
| 10 | Big Ben |
| 11 | Legs eleven |
| 12 | One dozen |
| 13 | Unlucky for some |
| 14 | Valentine's Day |
| 15 | Young and keen |
| 16 | Sweet sixteen |
| 17 | Dancing queen |
| 18 | Coming of age |
| 19 | Goodbye teens |
| 20 | One score |
| 21 | Key of the door |
| 22 | Two little ducks |
| 23 | Thee and me |
| 24 | Two dozen |
| 25 | Duck and dive |
| 26 | Pick and mix |
| 27 | Gateway to heaven |
| 28 | Over weight |
| 29 | Rise and shine |
| 30 | Dirty Gertie |
| 31 | Get up and run |
| 32 | Buckle my shoe |
| 33 | All the threes |
| 34 | Ask for more |
| 35 | Jump and jive |
| 36 | Three dozen |
| 37 | More than eleven |
| 38 | Christmas cake |
| 39 | Steps |
| 40 | Naughty forty |
| 41 | Time for fun |
| 42 | Answer to everything |
| 43 | Down on your knees |
| 44 | Droopy drawers |
| 45 | Halfway there |
| 46 | Up to tricks |
| 47 | Four and seven |
| 48 | Four dozen |
| 49 | PC |
| 50 | Half a century |
| 51 | Tweak of the thumb |
| 52 | Danny La Rue |
| 53 | Stuck in the tree |
| 54 | Clean the floor |
| 55 | Snakes alive |
| 56 | Was she worth it? |
| 57 | Heinz varieties |
| 58 | Make them wait |
| 59 | Brighton line |
| 60 | Five dozen |
| 61 | Bakers run |
| 62 | Turn the screw |
| 63 | Tickle me 63 |
| 64 | Red raw |
| 65 | Old age pension |
| 66 | Clickety click |
| 67 | Stairway to heaven |
| 68 | Saving grace |
| 69 | Either way up |
| 70 | Three score and ten |
| 71 | Bang on the drum |
| 72 | Six dozen |
| 73 | Queen bee |
| 74 | Hit the floor |
| 75 | Strive and thrive |
| 76 | Trombones |
| 77 | Sunset strip |
| 78 | Heaven's gate |
| 79 | One more time |
| 80 | Eight and blank |
| 81 | Stop and run |
| 82 | Straight on through |
| 83 | Time for tea |
| 84 | Seven dozen |
| 85 | Staying alive |
| 86 | Between the sticks |
| 87 | Torquay in Devon |
| 88 | Two fat ladies |
| 89 | Nearly there |
| 90 | Top of the shop |

Some calls are cheeky; keep the set family-friendly by reviewing or replacing anything the group does not want.

When a number has no specific call, use a random generic hype line:

- “Eyes down, mark it!”
- “No slacking now!”
- “Lucky you!”
- “Get in there!”
- “Keep those tickets ready!”
- “Full house fever!”
- “Come on now!”
- “Mark it if you have it!”

Avoid repeating the same generic line twice in a row.

### Voice channel

- The bot joins the selected voice channel when the lobby opens.
- If music is connected, TTS is disabled for that game because the bot can only have one voice connection and one active audio player per guild. The game runs text-only and the card says so.
- If the KittenTTS service and the local fallback fail, time out, or the voice connection fails, TTS is disabled (soft-fail after 3 synthesis failures) and the game continues text-only.
- The bot leaves voice when the game ends or is cancelled.
- TTS is supplementary; the game card and ticket are always the source of truth.

### Runtime dependencies

- Add `edge-tts` to `deploy/podman/Containerfile.bot` (local fallback):
  ```dockerfile
  pip install --no-cache-dir --break-system-packages yt-dlp edge-tts
  ```
- Cache directory: `/tmp/siela-tambola-tts/`.
- Use a short timeout (about 10 seconds) for synthesis.
- Limit synthesis concurrency to one at a time.
- Cache key: SHA-1 of `voice + rate + text`.
- Cache files are safe to delete at any time; they are regenerated on demand.

## State model

```ts
type TambolaStatus = "lobby" | "active" | "paused" | "finished" | "cancelled";
type ClaimPattern = "top_line" | "middle_line" | "bottom_line" | "full_house";

interface TambolaTicket {
  rows: (number | null)[][]; // 3 x 9
}

interface TambolaPlayer {
  userId: string;
  displayName: string;
  tickets: TambolaTicket[];
  marked: Set<number>;
  autoMark: boolean;
  joinedAt: number;
}

interface TambolaGameState {
  id: string;
  guildId: string;
  channelId: string;
  hostId: string;
  status: TambolaStatus;
  players: Map<string, TambolaPlayer>;
  called: number[];
  calledSet: Set<number>;
  deck: number[];
  claims: Map<ClaimPattern, { userId: string; atCall: number }>;
  intervalSeconds: 12;
  maxPlayers: number;
  startedAt: number | null;
  endedAt: number | null;
  winnerId: string | null;
}
```

Important: marks are stored per player. Claims validate the player's `marked` set, not just the called set.

## State machine

```text
lobby ──start──> active ──pause──> paused
  │                │  ^              │
  │                │  └──resume──────┘
  │                ├──full house──> finished
  │                └──90 calls────> finished
  ├──host leaves (lobby)──> cancelled
  └──timeout──────> cancelled

active ──host leaves──> active (host transfers to first remaining player)
active ──last player leaves──> cancelled
```

## Architecture

### Pure engine

`apps/bot/src/features/tambola/game.ts`

- Ticket generation.
- Deck and calls.
- Join/leave/start.
- Marking.
- Claim validation.
- Pause/resume/end.
- No Discord dependencies.
- Fully unit-testable.

### Discord service

`apps/bot/src/features/tambola/service.ts`

- Owns `Map<guildId, TambolaSession>` and `Map<gameId, TambolaSession>`.
- Posts and edits lobby/game cards.
- Sends DM tickets and fallback ephemeral tickets.
- Runs the 12-second auto-call timer (host-selectable fast/slow).
- Routes `tambola:` buttons and select menus.
- Handles DM interactions where `interaction.guild` is null by resolving the game ID.
- Cleans up on channel deletion, guild member removal, and shutdown.

### Voice/TTS service

`apps/bot/src/features/tambola/voice.ts`

- Joins the selected voice channel.
- Synthesizes phrases via the KittenTTS service at runtime (Edge TTS local fallback).
- Caches generated audio files.
- Plays number, flavour, and cue clips.
- Leaves on end/cancel.
- Fails soft to text-only.

### UI

`apps/bot/src/features/tambola-ui.ts`

- Lobby payload.
- Live payload with called board.
- Ticket DM/ephemeral payload.
- Claim select.
- Final payload.

### Command

`apps/bot/src/commands/social/tambola.ts`

- Slash subcommands and prefix arguments.
- Host/player permission checks.
- Friendly errors.

### Wiring

- Add `tambola: TambolaService` to `Services`.
- Instantiate in `bot.ts`.
- Route `tambola:` interactions in `onInteraction`.
- Add `tambola` to `commands/index.ts`.
- Add channel/delete and member/remove cleanup.
- Add `docs/TAMBOLA.md` usage notes.
- Add `edge-tts` to the bot runtime image (local fallback).

## Persistence

Active games are in memory only. A restart cancels active games.

Stats, leaderboards, and completed-game history are deferred. When added later, the likely tables are:

- `tambola_games`
- `tambola_participants`
- `tambola_claims`

No database migration is needed in v1.

## Lifecycle and limits

- Lobby auto-cancels after 5 minutes without a start.
- Game auto-ends after 90 calls or 45 minutes.
- One active game per guild.
- Max 20 players; min 2 to start.
- Manual calls throttled to one every 2 seconds.
- Joining after start is rejected.
- Leaving after start is rejected.
- Bots cannot join.
- Host can join their own game.
- If the game card message is deleted, the game continues; `/tambola status` still works.
- If the bot restarts, stale buttons reply “This game is no longer active.”
- If a player leaves the guild after joining, keep their ticket; they simply cannot claim.

## Interaction safety

- Validate every mark and claim server-side.
- Never trust button/select payloads for ticket state.
- Do not reveal tickets publicly.
- Do not ping winners; the bot suppresses mentions.
- Serialize state mutations synchronously before awaiting Discord edits.
- First valid claim wins; check the claims map before awarding.
- Rate-limit marks, claims, and manual calls.
- Guard against stale interactions after a game ends.
- Handle DM interactions without a guild by using the game ID.
- If the DM ticket is stale, any mark interaction still validates against current state.

## TTS and music conflict

The bot can only have one voice connection and one active audio player per guild.

- If music is active, Tambola TTS is disabled for that game.
- The lobby/game card says `Text only · music active`.
- The host can stop music and reopen the lobby to use TTS.
- Tambola never interrupts or queues over music in v1.

## Testing

### Unit tests

- Generate 1,000 tickets and assert:
  - 3 rows, 9 columns.
  - 5 numbers per row.
  - 1–3 numbers per column.
  - Every number is within its column range.
  - No duplicates.
  - Columns are sorted.
- Call deck contains each number 1–90 exactly once.
- Marking:
  - Called number on ticket is accepted.
  - Uncalled number is rejected.
  - Number not on ticket is rejected.
  - Duplicate mark is rejected.
- Claim validation for every pattern:
  - Valid claim.
  - Claim with called but unmarked numbers.
  - Claim too early.
  - Already claimed.
  - Wrong player.
  - Claim after finish.
- State transitions: lobby → active → paused → active → finished; lobby → cancelled.
- Timer behavior with fake timers.

### Manual playtest

- Two-player game with manual calls and TTS.
- Five-player game with auto-calls and TTS.
- DM ticket with 15 buttons and claim select.
- DM-closed fallback.
- Marking called and uncalled numbers.
- Claim each pattern and verify card updates.
- Invalid claim then valid claim.
- Pause/resume.
- Host end confirmation.
- Host leaves before start.
- Host leaves after start.
- Channel deletion.
- Music-active text-only fallback.
- TTS failure/timeout fallback.
- TTS cache hit and cache growth limits.
- Restart with a stale card.
- `/tambola ticket` and **My ticket**.

## Implementation phases

1. **Engine + tests** — ticket generator, deck, marking, claims, state machine.
2. **Service + commands** — lobby, join/leave/start, DM tickets, timers, one-game-per-guild guard.
3. **Live UI + interactions** — game card, called board, DM ticket buttons, claim select, host controls.
4. **TTS** — KittenTTS service synthesis (streaming preferred), Edge local fallback, cache, voice service, intro/call/claim cues, text-only fallback.
5. **Playtest + polish** — edge cases, docs, deployment.

Stats and leaderboards are a later phase.

## Defaults

- Max players: 20
- Min players: 2
- Auto-call interval: 12 seconds; fast 8s and slow 15s options
- Auto-marking: on by default and host-toggleable in lobby settings; players can additionally buy per-player auto-mark (10 SC, all of their tickets), which re-enables it for them individually
- Lobby timeout: 5 minutes
- Game timeout: 45 minutes
- Manual call throttle: 2 seconds
- TTS voice: KittenTTS service primary (`KittenML/kitten-tts-nano-0.8`, Bruno); Edge TTS local fallback (`en-IN-NeerjaNeural`, slightly slowed)
- TTS engine: KittenTTS service at runtime (streaming preferred), Edge TTS local fallback
- TTS cache: `/tmp/siela-tambola-tts/`
- Generic flavour pool: 15–20 lines
- Number-specific classic calls for 1–90 where available

## Out of scope for v1

- Stats, leaderboards, and game history.
- Image-rendered tickets.
- Cross-guild games.

Economy integration:
- Players can buy multiple tickets in one game.
- Auto-mark is purchased per player and applies to all of that player's tickets.
- Extra tickets and auto-mark are charged through the economy service.

- Tournament brackets.
- Spectator-only mode.
- Music and Tambola TTS mixed together.
