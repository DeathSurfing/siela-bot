# TTS and Voice

Standalone `/tts` channel narration and the Tambola voice stack share one engine: `TambolaVoice` (`apps/bot/src/features/tambola/voice.ts`).

## Standalone `/tts`

- `/tts on` joins the caller's voice channel (needs Connect + Speak). `/tts off` leaves.
- `TtsService` (`apps/bot/src/features/tts.ts`) keeps one session per guild.
- While enabled, plain messages in the voice channel's own text chat are spoken. Messages starting with `/` or `!` are skipped (`apps/bot/src/bot.ts`).
- Each message is trimmed to 200 characters.
- Mentions are resolved before speaking: `<@id>` becomes the member's display name, `<#id>` the channel name, `<@&id>` the role name, custom emoji becomes its name, `@everyone`/`@here` become "everyone" / "everyone here". Unknown mentions fall back to "someone" / "a channel" / "a role".
- Links become "a link". A message holding only links is spoken as "{User} sent a link". Attachment-only messages become "{User} sent an image/file/...".
- The speaker's display name is prefixed as "{User} said, ..." only when the speaker changed since the previous spoken message; consecutive messages from the same person skip the name (same rule for "sent a link" / attachments).
- Cooldown: 3s on the command. No economy charge for TTS.

## Voice ownership

Only one feature can own the guild voice connection at a time. Music, Tambola, standalone TTS, random voice drops, and scheduled events coordinate through the music voice lock.

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Music: play or join
  Music --> Idle: stop, disconnect, or queue end
  Idle --> Tambola: host starts a game
  Tambola --> Tambola: pause, resume, calls
  Tambola --> Idle: end or cancel
  Idle --> TTS: /tts on
  TTS --> Idle: /tts off
  Idle --> Random: rare drop
  Random --> Idle: clip ends
  Idle --> Event: prayer phase
  Event --> Idle: audio ends
```

Tambola and standalone TTS stop music, preserve the queue, and lock the voice channel for the session. Music commands are rejected while the lock is active. Random voice drops and scheduled events skip the channel while music, Tambola, or TTS is using voice.

## Tambola voice

Tambola creates its own `TambolaVoice` per game via `apps/bot/src/features/tambola/service.ts`. Same synthesis path, same failure behavior.

## Synthesis chain

Order in `TambolaVoice.speak()` / `synthesizeNow()`:

1. Remote streaming: `POST {TTS_SERVICE_URL}/synthesize-stream`, used when `TTS_SERVICE_URL` is set and `TTS_STREAM=true`. Audio streams directly into the Discord player.
2. Remote buffered: `POST {TTS_SERVICE_URL}/synthesize`, written to the cache file, then played.
3. Local backend: only when `TTS_SERVICE_URL` is unset.
   - `TTS_BACKEND=edge` (default): `python3 -m edge_tts --voice en-IN-NeerjaNeural --rate=-5%`, MP3 output, 2 attempts, 30s timeout.
   - `TTS_BACKEND=kitten` / `kitten-mini`: daemon scripts via `TTS_PYTHON` + `KITTEN_TTS_SCRIPT` (defaults `/app/assets/tts/kitten_tts_daemon.py` / `kitten_tts_mini_daemon.py`), WAV output.
   - `TTS_VOICE` overrides the kitten voice (default `Bruno`, `Jasper` for kitten-mini).

## Primary TTS service (compose)

`deploy/podman/tts/server.py` (FastAPI, image `localhost/siela-tts:latest`):

- Model `KittenML/kitten-tts-nano-0.8` (`KITTEN_TTS_MODEL`), voice `Bruno` (`TTS_VOICE`), speed `1.0` (`TTS_SPEED`), 24 kHz WAV.
- `GET /healthz`, `POST /synthesize` (buffered WAV), `POST /synthesize-stream` (chunked WAV via `chunk_text`).
- Bot env in `deploy/podman/compose.yaml`: `TTS_SERVICE_URL=http://tts:8000`, `TTS_STREAM=true`.

## Env vars

| Var | Default | Used by |
|---|---|---|
| `TTS_SERVICE_URL` | unset (compose: `http://tts:8000`) | bot, remote synthesis |
| `TTS_STREAM` | unset (compose: `true`) | bot, streaming vs buffered remote |
| `TTS_BACKEND` | `edge` | bot, local fallback only |
| `TTS_VOICE` | `Bruno` (kitten) / `Jasper` (kitten-mini) | bot + TTS service |
| `TTS_PYTHON` | `python3` | bot, local synthesis |
| `KITTEN_TTS_SCRIPT` | `/app/assets/tts/kitten_tts_daemon.py` (or `kitten_tts_mini_daemon.py`) | bot, kitten backends |
| `KITTEN_TTS_MODEL` | `KittenML/kitten-tts-nano-0.8` | TTS service |
| `TTS_SPEED` | `1.0` | TTS service |

## Cache

- Dir `/tmp/siela-tambola-tts` (compose bot uses a tmpfs `/tmp`).
- Key: SHA-1 of `voice + \0 + rate + \0 + text`. Extension `.wav` for kitten, `.mp3` otherwise.
- Hit returns the cached file if non-empty. Pruned every 20 syntheses down to 300 newest files. Safe to delete anytime.

## Failure behavior

- Synthesis calls are serialized through one chain; playback interrupts the current clip.
- Any synthesis path counts failures; at 3 failures `TambolaVoice.disabled` is set and the game/session continues text-only. Tambola never blocks the game loop on TTS.
- `join()` fails soft (returns false) when permissions are missing, a voice connection already exists, or the connection times out (15s).

## Music voice lock

- One voice connection per guild. Enabling `/tts` disconnects music and calls `music.lockVoice(guildId)`; disabling calls `music.unlockVoice(guildId)` (`apps/bot/src/features/tts.ts`).
- Tambola does the same for the game duration (`apps/bot/src/features/tambola/service.ts`).
- While locked, music `play`/`join` rejects with "Tambola is using the voice channel..."; the lock auto-clears if nothing is actually using voice (`apps/bot/src/features/music.ts`).
- Random VC moments (`apps/bot/src/features/randomVc.ts`) and scheduled event audio/tests (`apps/bot/src/features/scheduledEvents.ts`) skip while the voice is locked or busy.
