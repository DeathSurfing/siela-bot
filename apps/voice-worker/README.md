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

## Status

Verified in a live voice channel on the production host, using worker 2's
Discord token in place of the TypeScript worker:

| Case | Result |
|---|---|
| Login, guild bind, heartbeat | gateway, guild, and valkey all ready |
| Live stream (radio) | played; ffmpeg child 69 MB, worker 12 MB |
| Normal track (in-process decode) | played; **3 MB anon, 16 MB total, one process** |
| Comparable TypeScript worker | 53 MB idle, plus mpv at about 45 MB while playing |

Not yet wired into compose. The TypeScript worker remains the deployed one
until this is switched over in `scripts/make-voice-overlay.sh` and rolled out.
