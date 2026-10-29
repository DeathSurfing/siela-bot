# Voice worker (Rust)

A drop-in replacement for the TypeScript voice worker (`bun dist/worker.js`).
Same environment, same internal API on `:3101`, same health on `:3002`, same
Valkey heartbeat, so the router and control API cannot tell the difference.

## Why

Measured on the production host, the Bun worker holds about 53 MB of private
memory while idle and 108 MB of RSS. The Rust worker holds about 2 MB of
private memory and 8 MB of RSS with the gateway connected and the guild cache
populated. Per active stream the Bun worker also keeps a decoder process
(mpv at about 45 MB or ffmpeg at about 30 MB) alive for the whole track. This
worker decodes in process with symphonia, so that process does not exist.

## Voice encryption (DAVE)

Discord now requires the DAVE end-to-end encryption protocol on voice
connections. A client that does not speak it is rejected at the voice
WebSocket with close code 4017, `E2EE/DAVE protocol required`.

The TypeScript worker works because `@discordjs/voice` 0.19.2 depends on
`davey`. This worker needs songbird **0.6 or newer**, which has DAVE support
through `davey`; songbird 0.4 fails every join with 4017. That is why the
dependency is pinned to 0.6 rather than 0.4.

## Audio pipeline

```
yt-dlp -g or cache download
        |
        v
symphonia (in process, feature-gated codecs)
        |
        v
songbird mixer -> Opus -> Discord
```

`AUDIO_DECODER=inprocess` (default) downloads the track to the cache and lets
symphonia decode the file. `AUDIO_DECODER=ffmpeg` spawns ffmpeg per track and
feeds its WAV output through songbird's `ChildContainer`; use it for formats
symphonia cannot demux.

Seeking and filter presets always take the ffmpeg path because they need
re-encoding.

## Layout

| File | Purpose |
|---|---|
| `src/main.rs` | Bootstrap: config, logging, gateway, servers, heartbeat |
| `src/config.rs` | Environment, matching `packages/config` defaults |
| `src/model.rs` | `Track`, `MusicState`, `TtsState`, loop and filter enums |
| `src/resolve.rs` | yt-dlp resolution, ported from `MusicService::resolve` |
| `src/cache.rs` | On-disk cache with the same 8-file, 250 MB pruning |
| `src/audio.rs` | Builds a songbird `Input`, in process or via ffmpeg |
| `src/player.rs` | Playback actor owning the queue and the songbird call |
| `src/api.rs` | Internal worker API, route-for-route with `control/worker.ts` |
| `src/tts.rs` | Sticky TTS session, synthesis stays on the TTS service |
| `src/fleet.rs` | Valkey heartbeat and queue persistence |
| `src/health.rs` | `/healthz`, `/readyz`, `/metrics` |

## Build

```bash
podman build -f apps/voice-worker/Containerfile -t localhost/siela-voice-worker .
```

The runtime image keeps ffmpeg and yt-dlp because yt-dlp shells out to ffmpeg
for HLS downloads. Playback itself does not need either.

## Environment

Identical to the TypeScript worker: `DISCORD_TOKEN`, `MCP_TOKEN`, `GUILD_ID`,
`NODE_ID`, `NODE_ADVERTISE_URL`, `VALKEY_URL`, `WORKER_INTERNAL_PORT`,
`HEALTH_PORT`, `YTDLP_PATH`, `FFMPEG_PATH`, `TTS_SERVICE_URL`, `LOG_LEVEL`.
Adds `AUDIO_DECODER` (`inprocess` or `ffmpeg`).

## Music and TTS together

A worker holds one voice connection per guild, so TTS shares it. Clips go into
songbird's mixer with `play_input`, which means speech plays over the music
instead of replacing it. A new utterance stops only the previous clip. Track
end events are attached per music track with a sequence number, so a finished
TTS clip never advances the queue and a replaced track cannot advance it twice.

Speech uses its own gain, so `/volume 0` does not silence narration. The
session ends 30 seconds after the last text and releases the voice connection
after the same idle grace as music. Turning TTS off never moves the bot away
from a stream, and a music play for another channel is refused while a TTS
session owns the connection. `/internal/music/disconnect` ends the TTS session
with the connection.

The router can therefore attach a TTS session to a worker that is already
playing, as long as the music is in the same channel and no idle node exists.
That lets a three-node fleet carry three music streams plus speech.

The commander does not mix. `@discordjs/voice` needs a second voice connection
for TTS there, which Discord does not allow, so it still stops music. The
router only mixes on nodes that advertise `ttsMix` in their heartbeat, and
only Rust workers set it.

## Status

Feature-complete against the worker contract. Implemented: login, guild bind,
heartbeat, queue persistence and restore, resolve and play, pause, resume,
skip, seek, volume, loop, shuffle, remove, move, jump, autoplay, filters,
TTS session with warmup and clip cache, the TTS voice lock, and idle
auto-leave 30 seconds after the queue drains.

Verified live in a real voice channel on the production host:

| Case | Result |
|---|---|
| Login, guild bind, heartbeat | gateway, guild, and valkey all ready |
| Live stream (radio) | played; ffmpeg child 69 MB, worker 12 MB |
| Normal track (in-process decode) | played; **3 MB anon, 16 MB total, one process** |
| Comparable TypeScript worker | 53 MB idle, plus mpv at about 45 MB while playing |

Not yet exercised live: TTS playback, the queue-edit operations, autoplay,
and more than one channel at once. They are implemented and compile; they
need a pass in a live guild.

To deploy, generate the overlay with the Rust runtime:

```bash
WORKER_RUNTIME=rust ./scripts/make-voice-overlay.sh 2
```

The TypeScript worker remains the default (`WORKER_RUNTIME=bun`) until this is
switched over.
