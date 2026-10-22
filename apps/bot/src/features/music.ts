import { EventEmitter } from "node:events";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, mkdirSync, readdirSync, rmSync, statSync, utimesSync, type ReadStream } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type AudioPlayer,
  type AudioResource,
  type VoiceConnection,
} from "@discordjs/voice";
import { ChannelType, type Client, type GuildMember, type Message } from "discord.js";
import type { MusicLoopMode, MusicQueueState, MusicTrackInfo } from "@siela/shared";
import { UserError, ServiceUnavailableError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import type { SettingsService } from "./settings.js";
import { buildMusicPayload } from "./music-ui.js";
import type { ValkeyService } from "./valkey.js";

const execFileAsync = promisify(execFile);
const AUDIO_FORMAT = "bestaudio[abr<=312]/bestaudio/best[abr<=312]/best";
const SPOTIFY_COLLECTION_RE =
  /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:user\/[^/]+\/)?(playlist|album)\/([A-Za-z0-9]+)/i;

export interface MusicServiceOptions {
  backend: "mpv" | "ffmpeg";
  ytdlpPath: string;
  mpvPath: string;
  ffmpegPath: string;
  settings: SettingsService;
}

export interface QueueTrack {
  url: string;
  title: string;
  author: string;
  length: number;
  isStream: boolean;
  artworkUrl: string | null;
}

export type MusicFilterPreset = "off" | "bassboost" | "nightcore" | "vaporwave";

interface ResolvedTrack {
  url: string;
  title: string;
  author: string;
  length: number;
  isStream: boolean;
  artworkUrl: string | null;
}

interface SpotifyEmbedTrack {
  title?: string;
  subtitle?: string;
  duration?: number;
  isPlayable?: boolean;
  entityType?: string;
}

interface SpotifyEmbedEntity {
  name?: string;
  title?: string;
  coverArt?: { sources?: Array<{ url?: string }> };
  visualIdentity?: { image?: Array<{ url?: string }> };
  trackList?: SpotifyEmbedTrack[];
}

interface SpotifyPlaylist {
  name: string;
  artworkUrl: string | null;
  tracks: Array<{ title: string; artist: string; length: number }>;
}

function cleanSpotifyText(value: string | undefined): string {
  return (value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function pickThumbnail(entry: Record<string, unknown>): string | null {
  if (typeof entry.thumbnail === "string") return entry.thumbnail;
  if (!Array.isArray(entry.thumbnails)) return null;
  const best = entry.thumbnails
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .sort(
      (left, right) =>
        Number(right.width ?? 0) * Number(right.height ?? 0) -
        Number(left.width ?? 0) * Number(left.height ?? 0),
    )[0];
  return typeof best?.url === "string" ? best.url : null;
}

function parseJsonLines(stdout: string): Array<Record<string, unknown>> {
  const objects: Array<Record<string, unknown>> = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") objects.push(parsed as Record<string, unknown>);
    } catch {
      // yt-dlp can emit a partial line before failing; ignore it and use the rest.
    }
  }
  return objects;
}

function toInfo(track: QueueTrack): MusicTrackInfo {
  return {
    title: track.title,
    author: track.author,
    length: track.length,
    uri: track.url,
    artworkUrl: track.artworkUrl,
    isStream: track.isStream,
  };
}

function trackInfo(track: QueueTrack | null): MusicTrackInfo | null {
  return track ? toInfo(track) : null;
}

function isQueueTrack(value: unknown): value is QueueTrack {
  if (!value || typeof value !== "object") return false;
  const track = value as Record<string, unknown>;
  return (
    typeof track.url === "string" &&
    typeof track.title === "string" &&
    typeof track.author === "string" &&
    typeof track.length === "number" &&
    typeof track.isStream === "boolean" &&
    (track.artworkUrl === null || typeof track.artworkUrl === "string")
  );
}

export function isPlaylistUrl(query: string): boolean {
  return (
    /[?&]list=/i.test(query) ||
    /music\.youtube\.com\/playlist/i.test(query) ||
    /(?:youtube\.com|youtu\.be)\/playlist/i.test(query)
  );
}

class GuildPlayer {
  readonly queue: QueueTrack[] = [];
  readonly history: QueueTrack[] = [];
  current: QueueTrack | null = null;
  loop: MusicLoopMode = "off";
  autoplay = false;
  volume = 80;
  paused = false;
  filterPreset: "off" | "bassboost" | "nightcore" | "vaporwave" = "off";
  private ytdlpProcess: ChildProcess | null = null;
  private mpvProcess: ChildProcess | null = null;
  private ffmpegProcess: ChildProcess | null = null;
  private fifoPath: string | null = null;
  private fifoStream: ReadStream | null = null;
  private ipcSocketPath: string | null = null;
  resource: AudioResource | null = null;
  private startedAt = 0;
  private pausedAt: number | null = null;
  private advancing = false;
  private restarting = false;
  private restartTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly guildId: string,
    readonly connection: VoiceConnection,
    readonly player: AudioPlayer,
    private readonly service: MusicService,
  ) {
    this.player.on(AudioPlayerStatus.Idle, () => {
      // Killing the old PCM stream can make the player emit Idle before the
      // replacement resource starts. Do not advance the queue for that.
      if (this.restarting) {
        this.service.logger.debug({ guildId: this.guildId }, "ignoring idle during stream replacement");
        return;
      }
      if (!this.advancing) void this.advance();
    });
    this.player.on(AudioPlayerStatus.Playing, () => {
      this.endRestart();
    });
    this.player.on("error", (error) => {
      if (this.restarting) return;
      this.service.logger.warn({ err: error, guildId: this.guildId }, "audio player error");
      if (!this.advancing) void this.advance();
    });
    this.connection.on(VoiceConnectionStatus.Disconnected, () => {
      this.service.logger.warn({ guildId: this.guildId }, "voice connection disconnected; attempting to resume");
      void (async () => {
        try {
          await Promise.race([
            entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
          await entersState(this.connection, VoiceConnectionStatus.Ready, 15_000);
          this.service.logger.info({ guildId: this.guildId }, "voice connection resumed");
        } catch (error) {
          this.service.logger.warn({ err: error, guildId: this.guildId }, "voice reconnect failed");
          await this.service.disconnect(this.guildId);
        }
      })();
    });
    this.connection.on(VoiceConnectionStatus.Destroyed, () => {
      this.stopProcess();
    });
  }

  private killProcesses(): void {
    for (const process of [this.ytdlpProcess, this.mpvProcess, this.ffmpegProcess]) {
      if (!process) continue;
      process.stdout?.on("error", () => undefined);
      process.stderr?.on("error", () => undefined);
      process.stdin?.on("error", () => undefined);
      process.kill("SIGKILL");
    }
    this.ytdlpProcess = null;
    this.mpvProcess = null;
    this.ffmpegProcess = null;
    this.resource = null;
    this.fifoStream?.destroy();
    this.fifoStream = null;
    if (this.fifoPath) {
      try {
        rmSync(this.fifoPath, { force: true });
      } catch {
        // best effort
      }
      this.fifoPath = null;
    }
    if (this.ipcSocketPath) {
      try {
        rmSync(this.ipcSocketPath, { force: true });
      } catch {
        // best effort
      }
      this.ipcSocketPath = null;
    }
  }

  stopProcess(): void {
    this.killProcesses();
  }

  private beginRestart(): void {
    this.restarting = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restarting = false;
      this.restartTimer = null;
    }, 15_000);
    this.restartTimer.unref?.();
  }

  private endRestart(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.restarting = false;
  }

  private audioFilter(): string | null {
    return this.filterPreset === "bassboost"
      ? "bass=g=6"
      : this.filterPreset === "nightcore"
        ? "asetrate=48000*1.2,aresample=48000"
        : this.filterPreset === "vaporwave"
          ? "asetrate=48000*0.8,aresample=48000"
          : null;
  }

  private async directAudioUrl(track: QueueTrack): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        this.service.ytdlpPath,
        [
          "--js-runtimes",
          "node",
          "--no-part",
          "--no-cache-dir",
          "-g",
          "-f",
          AUDIO_FORMAT,
          "--no-playlist",
          "--no-warnings",
          "--quiet",
          track.url,
        ],
        { cwd: "/tmp", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
      );
      const url = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => /^https?:\/\//.test(line));
      if (!url) throw new Error("no direct audio URL");
      return url;
    } catch (error) {
      this.service.logger.warn({ err: error, title: track.title }, "yt-dlp direct URL failed");
      throw new ServiceUnavailableError(`Could not resolve audio for **${track.title}**.`);
    }
  }

  private async setMpvFilter(filter: string | null): Promise<boolean> {
    if (this.service.backend !== "mpv" || !this.ipcSocketPath) return false;
    const socketPath = this.ipcSocketPath;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const socket = createConnection(socketPath);
      const finish = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), 2_000);
      timer.unref?.();
      let data = "";
      socket.once("connect", () => {
        socket.write(`${JSON.stringify({ command: ["set_property", "af", filter ?? ""] })}\n`);
      });
      socket.on("data", (chunk: Buffer) => {
        data += chunk.toString();
        if (!data.includes("\n")) return;
        clearTimeout(timer);
        try {
          const line = data.split(/\r?\n/).find(Boolean);
          const parsed = JSON.parse(line ?? "") as { error?: string };
          finish(parsed.error === "success");
        } catch {
          finish(false);
        }
      });
      socket.once("error", () => {
        clearTimeout(timer);
        finish(false);
      });
      socket.once("close", () => {
        if (!settled) {
          clearTimeout(timer);
          finish(false);
        }
      });
    });
  }

  async applyFilterLive(): Promise<boolean> {
    return this.setMpvFilter(this.audioFilter());
  }

  private async startMpv(track: QueueTrack, startAtMs = 0): Promise<AudioResource> {
    const filter = this.audioFilter();
    const cached = this.service.cachedFile(track);
    const source = cached ?? (await this.directAudioUrl(track));
    if (!cached) void this.service.ensureCached(track);
    const fifoPath = `/tmp/siela-${this.guildId}-${randomUUID()}.pcm`;
    await execFileAsync("mkfifo", [fifoPath], { timeout: 5_000 });
    this.fifoPath = fifoPath;
    const ipcSocketPath = `/tmp/siela-${this.guildId}-${randomUUID()}.sock`;
    this.ipcSocketPath = ipcSocketPath;

    let stderr = "";
    const mpv = spawn(
      this.service.mpvPath,
      [
        "--no-config",
        "--no-video",
        "--no-terminal",
        `--input-ipc-server=${ipcSocketPath}`,
        "--really-quiet",
        "--ao=pcm",
        `--ao-pcm-file=${fifoPath}`,
        "--ao-pcm-waveheader=no",
        "--audio-format=s16",
        "--audio-samplerate=48000",
        "--audio-channels=stereo",
        "--ytdl=no",
        ...(startAtMs > 0 ? [`--start=${(startAtMs / 1000).toFixed(3)}`] : []),
        ...(filter ? [`--af=${filter}`] : []),
        "--",
        source,
      ],
      { cwd: "/tmp", env: { ...process.env, XDG_CACHE_HOME: "/tmp" }, stdio: ["ignore", "ignore", "pipe"] },
    );
    this.mpvProcess = mpv;
    mpv.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 4_000) stderr = stderr.slice(-4_000);
    });
    let meter: NodeJS.Timeout | null = null;
    mpv.on("error", (error) => {
      this.service.logger.warn({ err: error, guildId: this.guildId }, "mpv spawn failed");
    });
    mpv.on("close", (code) => {
      if (meter) clearInterval(meter);
      if (code && code !== 0) {
        this.service.logger.warn({ code, guildId: this.guildId, stderr: stderr.slice(-500) }, "mpv exited with an error");
      }
    });

    const stream = createReadStream(fifoPath);
    this.fifoStream = stream;
    meter = setInterval(() => {
      this.service.logger.debug(
        { guildId: this.guildId, pcmBytes: stream.bytesRead, mpvCode: mpv.exitCode },
        "mpv PCM stream",
      );
    }, 5_000);
    meter.unref?.();
    stream.once("close", () => clearInterval(meter));
    stream.once("error", () => clearInterval(meter));
    stream.on("error", (error) => {
      this.service.logger.debug({ err: error, guildId: this.guildId }, "mpv FIFO read stream closed");
    });
    return createAudioResource(stream, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });
  }

  private startFfmpeg(track: QueueTrack, startAtMs = 0): AudioResource {
    const filter = this.audioFilter();
    const cached = this.service.cachedFile(track);
    if (!cached) void this.service.ensureCached(track);

    let ytdlp: ChildProcess | null = null;
    if (!cached) {
      ytdlp = spawn(
        this.service.ytdlpPath,
        [
          "--js-runtimes",
          "node",
          "--no-part",
          "--no-cache-dir",
          "-f",
          AUDIO_FORMAT,
          "-o",
          "-",
          "--no-playlist",
          "--no-warnings",
          "--quiet",
          track.url,
        ],
        { cwd: "/tmp", stdio: ["ignore", "pipe", "pipe"] },
      );
      this.ytdlpProcess = ytdlp;
    }

    const ffmpeg = spawn(
      this.service.ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        cached ?? "pipe:0",
        ...(startAtMs > 0 ? ["-ss", (startAtMs / 1000).toFixed(3)] : []),
        ...(filter ? ["-af", filter] : []),
        "-f",
        "s16le",
        "-ar",
        "48000",
        "-ac",
        "2",
        "pipe:1",
      ],
      { cwd: "/tmp", stdio: [cached ? "ignore" : "pipe", "pipe", "pipe"] },
    );
    this.ffmpegProcess = ffmpeg;

    if (ytdlp) {
      ytdlp.stdout?.on("error", (error) => {
        this.service.logger.debug({ err: error, guildId: this.guildId }, "yt-dlp stdout closed");
      });
      ytdlp.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text) this.service.logger.debug({ guildId: this.guildId, ytdlp: text.slice(0, 200) }, "yt-dlp");
      });
      ytdlp.on("error", (error) => {
        this.service.logger.warn({ err: error, guildId: this.guildId }, "yt-dlp spawn failed");
      });
      ytdlp.stdout?.pipe(ffmpeg.stdin!);
    }
    ffmpeg.stdin?.on("error", (error) => {
      this.service.logger.debug({ err: error, guildId: this.guildId }, "ffmpeg stdin closed");
    });
    ffmpeg.stdout?.on("error", (error) => {
      this.service.logger.debug({ err: error, guildId: this.guildId }, "ffmpeg stdout closed");
    });
    ffmpeg.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) this.service.logger.debug({ guildId: this.guildId, ffmpeg: text.slice(0, 200) }, "ffmpeg");
    });
    ffmpeg.on("error", (error) => {
      this.service.logger.warn({ err: error, guildId: this.guildId }, "ffmpeg spawn failed");
    });
    return createAudioResource(ffmpeg.stdout!, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });
  }

  async playNow(track: QueueTrack, startAtMs = 0): Promise<void> {
    this.beginRestart();
    try {
      this.killProcesses();
      if (this.current && this.current.url !== track.url) {
        this.history.push(this.current);
        if (this.history.length > 10) this.history.shift();
      }
      this.current = track;
      this.pausedAt = null;
      this.paused = false;

      const resource =
        this.service.backend === "ffmpeg"
          ? this.startFfmpeg(track, startAtMs)
          : await this.startMpv(track, startAtMs);
      this.resource = resource;
      resource.volume?.setVolume(this.volume / 100);
      this.startedAt = Date.now() - Math.max(0, startAtMs);
      this.player.play(resource);
      this.service.emit("trackStart", { guildId: this.guildId, track: toInfo(track) });
      void this.service.saveQueue(this.guildId);
      this.service.prefetchAround(this);
    } catch (error) {
      this.endRestart();
      throw error;
    }
  }

  async advance(options: { ignoreTrackLoop?: boolean } = {}): Promise<void> {
    if (this.advancing) return;
    this.advancing = true;
    try {
      if (this.loop === "track" && this.current && !options.ignoreTrackLoop) {
        try {
          await this.playNow(this.current);
          return;
        } catch (error) {
          this.service.logger.warn({ err: error, guildId: this.guildId }, "loop replay failed; clearing loop");
          this.loop = "off";
        }
      }
      if (this.loop === "queue" && this.current) this.queue.push(this.current);

      let next = this.queue.shift();
      while (next) {
        try {
          await this.playNow(next);
          return;
        } catch (error) {
          this.service.logger.warn({ err: error, guildId: this.guildId, title: next.title }, "skipping unplayable track");
          next = this.queue.shift();
        }
      }

      const previous = this.current;
      this.current = null;
      void this.service.clearStoredQueue(this.guildId);
      this.killProcesses();
      this.player.stop(true);
      if (this.autoplay && previous) {
        const related = await this.service.autoplayTrack(previous);
        if (related) {
          try {
            await this.playNow(related);
            return;
          } catch (error) {
            this.service.logger.warn({ err: error, guildId: this.guildId }, "autoplay track failed");
          }
        }
      }
      this.service.emit("queueEnd", { guildId: this.guildId });
    } finally {
      this.advancing = false;
    }
  }

  positionMs(): number {
    if (!this.current) return 0;
    if (this.pausedAt) return this.pausedAt - this.startedAt;
    return Date.now() - this.startedAt;
  }

  state(): MusicQueueState {
    return {
      playing: Boolean(this.current) && !this.paused,
      paused: this.paused,
      volume: this.volume,
      loop: this.loop,
      position: this.positionMs(),
      current: trackInfo(this.current),
      upcoming: this.queue.map(toInfo),
    };
  }
}

export class MusicService extends EventEmitter {
  readonly logger: Logger;
  private readonly players = new Map<string, GuildPlayer>();
  private readonly cacheDir = "/tmp/siela-music-cache";
  private readonly cacheMaxBytes = 250 * 1024 * 1024;
  private readonly cacheInFlight = new Map<string, Promise<string | null>>();
  private readonly nowPlayingMessages = new Map<string, Message>();
  private readonly nowPlayingUpdating = new Set<string>();
  private readonly valkey: ValkeyService | null;
  private binariesCheckedAt = 0;
  private binariesOk = false;

  constructor(
    private readonly client: Client,
    private readonly options: MusicServiceOptions,
    logger: Logger,
    valkey: ValkeyService | null = null,
  ) {
    super();
    this.logger = logger;
    this.valkey = valkey;
    this.on("error", () => undefined);
    mkdirSync(this.cacheDir, { recursive: true });
    this.on("trackStart", (payload: { guildId: string }) => {
      void this.updateNowPlaying(payload.guildId);
    });
    this.on("queueEnd", (payload: { guildId: string }) => {
      void this.clearNowPlaying(payload.guildId);
    });
  }

  setNowPlayingMessage(guildId: string, message: Message): void {
    this.nowPlayingMessages.set(guildId, message);
  }

  refreshNowPlaying(guildId: string): void {
    void this.updateNowPlaying(guildId);
  }

  private async updateNowPlaying(guildId: string): Promise<void> {
    const message = this.nowPlayingMessages.get(guildId);
    if (!message || this.nowPlayingUpdating.has(guildId)) return;
    const state = this.state(guildId);
    if (!state?.current) {
      this.nowPlayingMessages.delete(guildId);
      return;
    }
    if (state.paused) return;
    this.nowPlayingUpdating.add(guildId);
    try {
      await message.edit(buildMusicPayload(guildId, state));
    } catch {
      this.nowPlayingMessages.delete(guildId);
    } finally {
      this.nowPlayingUpdating.delete(guildId);
    }
  }

  private async clearNowPlaying(guildId: string): Promise<void> {
    const message = this.nowPlayingMessages.get(guildId);
    this.nowPlayingMessages.delete(guildId);
    if (!message) return;
    await message.edit(buildMusicPayload(guildId, null)).catch(() => undefined);
  }

  private cacheKey(track: QueueTrack): string {
    return createHash("sha1").update(track.url).digest("hex");
  }

  private queueStoreKey(guildId: string): string {
    return `siela:music:queue:${guildId}`;
  }

  private async loadQueue(guildId: string): Promise<QueueTrack[]> {
    const client = this.valkey?.client;
    if (!client) return [];
    try {
      const raw = await client.get(this.queueStoreKey(guildId));
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isQueueTrack) : [];
    } catch (error) {
      this.logger.debug({ err: error, guildId }, "failed to restore music queue");
      return [];
    }
  }

  async saveQueue(guildId: string): Promise<void> {
    const client = this.valkey?.client;
    if (!client) return;
    const player = this.players.get(guildId);
    if (!player) return;
    try {
      await client.set(this.queueStoreKey(guildId), JSON.stringify(player.queue));
    } catch (error) {
      this.logger.debug({ err: error, guildId }, "failed to save music queue");
    }
  }

  async clearStoredQueue(guildId: string): Promise<void> {
    const client = this.valkey?.client;
    if (!client) return;
    await client.del(this.queueStoreKey(guildId)).catch(() => undefined);
  }

  cachedFile(track: QueueTrack): string | null {
    if (track.isStream) return null;
    const key = this.cacheKey(track);
    try {
      for (const filename of readdirSync(this.cacheDir)) {
        if (!filename.startsWith(`${key}.`) || filename.endsWith(".part")) continue;
        const path = join(this.cacheDir, filename);
        utimesSync(path, new Date(), new Date());
        return path;
      }
    } catch (error) {
      this.logger.debug({ err: error }, "music cache lookup failed");
    }
    return null;
  }

  async ensureCached(track: QueueTrack): Promise<string | null> {
    if (track.isStream) return null;
    const existing = this.cachedFile(track);
    if (existing) return existing;
    const key = this.cacheKey(track);
    const inFlight = this.cacheInFlight.get(key);
    if (inFlight) return inFlight;

    const promise = (async () => {
      try {
        const output = join(this.cacheDir, `${key}.%(ext)s`);
        const { stdout } = await execFileAsync(
          this.options.ytdlpPath,
          [
            "--js-runtimes",
            "node",
            "--no-part",
            "--no-cache-dir",
            "-f",
            AUDIO_FORMAT,
            "-o",
            output,
            "--no-playlist",
            "--no-warnings",
            "--quiet",
            "--max-filesize",
            "80M",
            "--print",
            "after_move:filepath",
            track.url,
          ],
          { cwd: this.cacheDir, timeout: 180_000, maxBuffer: 2 * 1024 * 1024 },
        );
        const printed = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean);
        const cached = printed && statSync(printed).size > 0 ? printed : this.cachedFile(track);
        if (cached) {
          this.logger.debug({ guildId: "global", title: track.title, path: cached }, "cached track audio");
          this.pruneCache();
          return cached;
        }
      } catch (error) {
        this.logger.warn({ err: error, title: track.title }, "failed to cache track audio");
      }
      return null;
    })().finally(() => this.cacheInFlight.delete(key));

    this.cacheInFlight.set(key, promise);
    return promise;
  }

  prefetchAround(player: GuildPlayer): void {
    const tracks = [player.current, player.queue[0], player.history[player.history.length - 1]];
    for (const track of tracks) {
      if (!track || track.isStream) continue;
      void this.ensureCached(track).catch(() => undefined);
    }
  }

  private pruneCache(maxFiles = 8): void {
    try {
      const files = readdirSync(this.cacheDir)
        .filter((filename) => !filename.endsWith(".part"))
        .map((filename) => {
          const path = join(this.cacheDir, filename);
          const stat = statSync(path);
          return { path, mtime: stat.mtimeMs, size: stat.size };
        })
        .sort((a, b) => b.mtime - a.mtime);
      let kept = 0;
      let total = 0;
      for (const file of files) {
        if (kept >= maxFiles || total + file.size > this.cacheMaxBytes) {
          rmSync(file.path, { force: true });
          continue;
        }
        kept += 1;
        total += file.size;
      }
    } catch (error) {
      this.logger.debug({ err: error }, "music cache prune failed");
    }
  }

  get backend(): "mpv" | "ffmpeg" {
    return this.options.backend;
  }

  get ytdlpPath(): string {
    return this.options.ytdlpPath;
  }

  get mpvPath(): string {
    return this.options.mpvPath;
  }

  get ffmpegPath(): string {
    return this.options.ffmpegPath;
  }

  async isUp(): Promise<boolean> {
    if (Date.now() - this.binariesCheckedAt < 60_000) return this.binariesOk;
    this.binariesCheckedAt = Date.now();
    try {
      await execFileAsync(this.options.ytdlpPath, ["--version"], { timeout: 10_000 });
      await execFileAsync(this.options[this.options.backend === "ffmpeg" ? "ffmpegPath" : "mpvPath"], [
        this.options.backend === "ffmpeg" ? "-version" : "--version",
      ], { timeout: 10_000 });
      this.binariesOk = true;
    } catch (error) {
      this.logger.warn({ err: error, backend: this.options.backend }, `${this.options.backend} backend not available`);
      this.binariesOk = false;
    }
    return this.binariesOk;
  }

  activePlayers(): number {
    return this.players.size;
  }

  isConnected(guildId: string): boolean {
    return this.players.has(guildId);
  }

  channelId(guildId: string): string | null {
    return this.players.get(guildId)?.connection.joinConfig.channelId ?? null;
  }

  private async spotifyToSearch(url: string): Promise<string | null> {
    try {
      const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { title?: string; author_name?: string };
      if (!data.title) return null;
      return [data.title, data.author_name].filter(Boolean).join(" ");
    } catch {
      return null;
    }
  }

  private async spotifyPlaylist(url: string): Promise<SpotifyPlaylist | null> {
    const match = url.match(SPOTIFY_COLLECTION_RE);
    const kind = match?.[1];
    const id = match?.[2];
    if (!kind || !id) return null;
    try {
      const response = await fetch(`https://open.spotify.com/embed/${kind}/${id}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; SielaBot/1.0)",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return null;
      const html = await response.text();
      const dataMatch = html.match(
        /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
      );
      if (!dataMatch?.[1]) return null;
      const parsed = JSON.parse(dataMatch[1]) as {
        props?: { pageProps?: { state?: { data?: { entity?: SpotifyEmbedEntity } } } };
      };
      const entity = parsed.props?.pageProps?.state?.data?.entity;
      if (!entity) return null;
      const artworkUrl =
        entity.coverArt?.sources?.find((source) => typeof source.url === "string")?.url ??
        entity.visualIdentity?.image?.find((image) => typeof image.url === "string")?.url ??
        null;
      const tracks = (entity.trackList ?? [])
        .filter((track) => track.isPlayable !== false && track.entityType !== "episode")
        .map((track) => ({
          title: cleanSpotifyText(track.title),
          artist: cleanSpotifyText(track.subtitle),
          length: Math.max(0, Number(track.duration ?? 0)),
        }))
        .filter((track) => track.title.length > 0);
      if (!tracks.length) return null;
      return {
        name: cleanSpotifyText(entity.name ?? entity.title),
        artworkUrl,
        tracks,
      };
    } catch (error) {
      this.logger.warn({ err: error, url }, "failed to read Spotify playlist");
      return null;
    }
  }

  private async ytdlpJsonLines(
    args: string[],
    query: string,
    timeoutMs = 120_000,
  ): Promise<Array<Record<string, unknown>>> {
    try {
      const result = await execFileAsync(this.options.ytdlpPath, args, {
        cwd: "/tmp",
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
      });
      return parseJsonLines(result.stdout);
    } catch (error) {
      const stdout = (error as { stdout?: string }).stdout;
      const partial = stdout ? parseJsonLines(stdout) : [];
      if (partial.length) return partial;
      this.logger.warn({ err: error, query }, "yt-dlp batch resolve failed");
      throw new ServiceUnavailableError("Music search failed. Try again in a moment.");
    }
  }

  private firstYtdlpEntry(object: Record<string, unknown>): Record<string, unknown> | null {
    if (Array.isArray(object.entries)) {
      const entry = object.entries.find((item) => item && typeof item === "object");
      return entry ? (entry as Record<string, unknown>) : null;
    }
    return object;
  }

  private async resolveSpotifyPlaylist(
    playlist: SpotifyPlaylist,
    limit: number,
  ): Promise<ResolvedTrack[]> {
    const wanted = playlist.tracks.slice(0, Math.max(1, limit));
    const queries = wanted.map((track) =>
      cleanSpotifyText(`${track.title} ${track.artist}`).slice(0, 200),
    );
    const objects = await this.ytdlpJsonLines(
      [
        "--dump-single-json",
        "--flat-playlist",
        "--playlist-end",
        "1",
        "--ignore-errors",
        "--no-warnings",
        "--quiet",
        "--js-runtimes",
        "node",
        "--no-part",
        "--no-cache-dir",
        ...queries.map((query) => `ytsearch1:${query}`),
      ],
      `spotify:${playlist.name}`,
      Math.min(300_000, 30_000 + queries.length * 5_000),
    );
    const byQuery = new Map<string, Record<string, unknown>>();
    for (const object of objects) {
      if (typeof object.id !== "string") continue;
      byQuery.set(object.id.replace(/^ytsearch\d+:/i, ""), object);
    }

    const resolved: ResolvedTrack[] = [];
    let fallbackBudget = 10;
    for (let index = 0; index < wanted.length; index += 1) {
      const spotifyTrack = wanted[index]!;
      const query = queries[index]!;
      const object = byQuery.get(query);
      const entry = object ? this.firstYtdlpEntry(object) : null;
      const url = entry ? (entry.webpage_url ?? entry.url) : null;
      if (entry && typeof url === "string") {
        const duration = Number(entry.duration ?? 0) * 1000;
        resolved.push({
          url,
          title: spotifyTrack.title || String(entry.title ?? "Unknown title"),
          author:
            spotifyTrack.artist ||
            String(entry.uploader ?? entry.channel ?? entry.artist ?? "Unknown artist"),
          length: duration > 0 ? duration : spotifyTrack.length,
          isStream: Boolean(entry.is_live),
          artworkUrl: pickThumbnail(entry) ?? playlist.artworkUrl,
        });
        continue;
      }

      if (fallbackBudget <= 0) continue;
      fallbackBudget -= 1;
      try {
        const found = await this.searchTracks(query, "ytsearch", 1);
        const fallback = found[0];
        if (!fallback) continue;
        resolved.push({
          ...fallback,
          title: spotifyTrack.title || fallback.title,
          author: spotifyTrack.artist || fallback.author,
          length: fallback.length || spotifyTrack.length,
          artworkUrl: fallback.artworkUrl ?? playlist.artworkUrl,
        });
      } catch (error) {
        this.logger.debug({ err: error, query }, "Spotify track fallback failed");
      }
    }
    return resolved;
  }

  private async ytdlpJson(args: string[], query: string): Promise<ResolvedTrack[]> {
    let stdout: string;
    try {
      const result = await execFileAsync(this.options.ytdlpPath, args, {
        cwd: "/tmp",
        timeout: 30_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      stdout = result.stdout;
    } catch (error) {
      this.logger.warn({ err: error, query }, "yt-dlp resolve failed");
      throw new ServiceUnavailableError("Music search failed. Try again in a moment.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new UserError("No tracks found for that search.", "no_tracks");
    }
    const root = parsed as {
      entries?: Array<Record<string, unknown>>;
    } & Record<string, unknown>;
    const entries = Array.isArray(root.entries) ? root.entries : [root];
    return entries.flatMap((entry) => {
      const url = (entry.webpage_url ?? entry.url) as string | undefined;
      if (!url) return [];
      return [{
        url,
        title: (entry.title as string) ?? "Unknown title",
        author: ((entry.uploader ?? entry.channel ?? entry.artist) as string) ?? "Unknown artist",
        length: Number(entry.duration ?? 0) * 1000,
        isStream: Boolean(entry.is_live),
        artworkUrl: (entry.thumbnail as string) ?? null,
      }];
    });
  }

  private async searchTracks(
    target: string,
    engine: "scsearch" | "ytsearch",
    limit = 5,
  ): Promise<ResolvedTrack[]> {
    return this.ytdlpJson(
      [
        "--dump-single-json",
        "--no-playlist",
        "--no-warnings",
        "--quiet",
        "--js-runtimes",
        "node",
        "--no-part",
        "--no-cache-dir",
        "--default-search",
        engine,
        "--playlist-end",
        String(Math.max(1, Math.min(limit, 10))),
        target,
      ],
      target,
    );
  }

  private async resolve(query: string, limit = 5): Promise<ResolvedTrack[]> {
    let target = query.trim().replace(/^["']|["']$/g, "").trim();
    if (SPOTIFY_COLLECTION_RE.test(target)) {
      const playlist = await this.spotifyPlaylist(target);
      if (!playlist) {
        throw new UserError(
          "Could not read that Spotify playlist. It may be private, region-locked, or empty.",
        );
      }
      const tracks = await this.resolveSpotifyPlaylist(playlist, limit);
      if (!tracks.length) {
        throw new UserError("No playable tracks were found in that Spotify playlist.", "no_tracks");
      }
      return tracks;
    }
    if (/open\.spotify\.com\//i.test(target)) {
      const search = await this.spotifyToSearch(target);
      if (!search) {
        throw new UserError("Could not read that Spotify link. Try a SoundCloud link or a search.");
      }
      target = search;
    }
    const isUrl = /^https?:\/\//i.test(target);
    const playlist = isUrl && isPlaylistUrl(target);

    if (isUrl) {
      const tracks = await this.ytdlpJson(
        playlist
          ? [
              "--dump-single-json",
              "--flat-playlist",
              "--yes-playlist",
              "--playlist-end",
              String(Math.max(1, Math.min(limit, 500))),
              "--no-warnings",
              "--quiet",
              "--js-runtimes",
              "node",
              "--no-part",
              "--no-cache-dir",
              target,
            ]
          : [
              "--dump-single-json",
              "--no-playlist",
              "--no-warnings",
              "--quiet",
              "--js-runtimes",
              "node",
              "--no-part",
              "--no-cache-dir",
              target,
            ],
        query,
      );
      if (!tracks.length) throw new UserError("No tracks found for that URL.", "no_tracks");
      return playlist ? tracks : [tracks[0]!];
    }

    // SoundCloud sometimes returns 30-second previews as search results.
    // Prefer a full-length SoundCloud result, then fall back to YouTube search.
    let soundCloudTracks: ResolvedTrack[] = [];
    let lastError: unknown;
    try {
      soundCloudTracks = await this.searchTracks(target, "scsearch");
    } catch (error) {
      lastError = error;
      this.logger.warn({ err: error, query }, "SoundCloud search failed; trying YouTube");
    }
    const fullSoundCloud = soundCloudTracks.filter((track) => track.isStream || track.length === 0 || track.length >= 45_000);
    if (fullSoundCloud.length) return [fullSoundCloud[0]!];

    try {
      const youtubeTracks = await this.searchTracks(target, "ytsearch");
      const fullYoutube = youtubeTracks.filter((track) => track.isStream || track.length === 0 || track.length >= 45_000);
      const chosen = fullYoutube[0] ?? youtubeTracks[0];
      if (chosen) {
        this.logger.info(
          { query, title: chosen.title, length: chosen.length },
          "using YouTube fallback because SoundCloud only returned short clips",
        );
        return [chosen];
      }
    } catch (error) {
      lastError = error;
      this.logger.warn({ err: error, query }, "YouTube fallback failed");
    }

    if (soundCloudTracks.length) return [soundCloudTracks[0]!];
    if (lastError instanceof UserError) throw lastError;
    throw new ServiceUnavailableError("Music search failed. Try again in a moment.");
  }

  private async ensurePlayer(member: GuildMember, voiceChannelId?: string): Promise<GuildPlayer> {
    const channelId = voiceChannelId ?? member.voice.channelId;
    if (!channelId) throw new UserError("Join a voice channel first.");
    const channel = member.guild.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) throw new UserError("That is not a voice channel.");
    const existing = this.players.get(member.guild.id);
    const existingStatus = existing?.connection.state.status;
    const usable =
      existing &&
      existingStatus !== VoiceConnectionStatus.Destroyed &&
      existingStatus !== VoiceConnectionStatus.Disconnected &&
      existing.connection.joinConfig.channelId === channelId;
    if (usable) return existing;
    if (existing) await this.disconnect(member.guild.id);

    const connection = joinVoiceChannel({
      channelId,
      guildId: member.guild.id,
      adapterCreator: member.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      this.logger.info({ guildId: member.guild.id, channelId }, "voice connection ready");
    } catch (error) {
      connection.destroy();
      this.logger.warn({ err: error, guildId: member.guild.id }, "voice connection failed");
      throw new ServiceUnavailableError("Could not join the voice channel.");
    }
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    const subscription = connection.subscribe(player);
    this.logger.info(
      {
        guildId: member.guild.id,
        subscribed: Boolean(subscription),
        connectionStatus: connection.state.status,
      },
      "audio player subscription",
    );
    connection.on("stateChange", (oldState, newState) => {
      this.logger.info(
        { guildId: member.guild.id, from: oldState.status, to: newState.status },
        "voice connection state",
      );
    });
    connection.on("debug", (message) => {
      this.logger.debug({ guildId: member.guild.id, message }, "voice debug");
    });
    connection.on("error", (error) => {
      this.logger.warn({ err: error, guildId: member.guild.id }, "voice connection error");
    });
    player.on("stateChange", (oldState, newState) => {
      this.logger.info(
        { guildId: member.guild.id, from: oldState.status, to: newState.status },
        "audio player state",
      );
    });
    player.on("debug", (message) => {
      this.logger.debug({ guildId: member.guild.id, message }, "audio player debug");
    });
    const guildPlayer = new GuildPlayer(member.guild.id, connection, player, this);
    const musicSettings = await this.options.settings.getMusic(member.guild.id);
    guildPlayer.volume = musicSettings.defaultVolume;
    const restored = await this.loadQueue(member.guild.id);
    if (restored.length) guildPlayer.queue.push(...restored);
    this.players.set(member.guild.id, guildPlayer);
    return guildPlayer;
  }

  async join(member: GuildMember, voiceChannelId?: string): Promise<string> {
    const guildPlayer = await this.ensurePlayer(member, voiceChannelId);
    const channelId = guildPlayer.connection.joinConfig.channelId;
    if (!channelId) throw new ServiceUnavailableError("Could not determine the voice channel.");
    return channelId;
  }

  async play(
    member: GuildMember,
    query: string,
    voiceChannelId?: string,
    next = false,
  ): Promise<{ added: number; first: MusicTrackInfo }> {
    const guildPlayer = await this.ensurePlayer(member, voiceChannelId);
    const settings = await this.options.settings.getMusic(member.guild.id);
    const available = Math.max(
      0,
      settings.maxQueueSize - guildPlayer.queue.length - (guildPlayer.current ? 1 : 0),
    );
    if (!available) throw new UserError("The queue is full. Use `clearqueue` to empty upcoming tracks.");
    const resolved = await this.resolve(query, available);
    const accepted = resolved.slice(0, available);
    if (!accepted.length) throw new UserError("No tracks could be queued.");
    const queueTracks: QueueTrack[] = accepted.map((track) => ({ ...track }));
    if (next) guildPlayer.queue.unshift(...queueTracks);
    else guildPlayer.queue.push(...queueTracks);
    if (!guildPlayer.current) {
      let first = guildPlayer.queue.shift();
      while (first) {
        try {
          await guildPlayer.playNow(first);
          return { added: queueTracks.length, first: toInfo(first) };
        } catch (error) {
          this.logger.warn({ err: error, guildId: member.guild.id, title: first.title }, "skipping unplayable track");
          first = guildPlayer.queue.shift();
        }
      }
      throw new UserError("None of those tracks could be played.");
    }
    void this.saveQueue(member.guild.id);
    this.prefetchAround(guildPlayer);
    return { added: queueTracks.length, first: toInfo(queueTracks[0]!) };
  }

  async autoplayTrack(previous: QueueTrack): Promise<QueueTrack | null> {
    try {
      const tracks = await this.resolve(`${previous.author} ${previous.title}`);
      const first = tracks[0];
      return first ? { ...first } : null;
    } catch (error) {
      this.logger.debug({ err: error }, "autoplay search failed");
      return null;
    }
  }

  private requirePlayer(guildId: string): GuildPlayer {
    const gp = this.players.get(guildId);
    if (!gp) throw new UserError("The bot is not playing anything.");
    return gp;
  }

  async pause(guildId: string): Promise<void> {
    const gp = this.requirePlayer(guildId);
    if (!gp.current) throw new UserError("Nothing is playing.");
    gp.paused = true;
    gp.player.pause();
  }

  async resume(guildId: string): Promise<void> {
    const gp = this.requirePlayer(guildId);
    if (!gp.current) throw new UserError("Nothing is playing.");
    gp.paused = false;
    gp.player.unpause();
  }

  async skip(guildId: string, count = 1): Promise<void> {
    const gp = this.requirePlayer(guildId);
    if (!gp.current) throw new UserError("Nothing is playing.");
    if (count > 1) gp.queue.splice(0, Math.max(0, count - 1));
    gp.stopProcess();
    await gp.advance({ ignoreTrackLoop: true });
  }

  async stop(guildId: string): Promise<void> {
    const gp = this.players.get(guildId);
    if (!gp) return;
    gp.queue.length = 0;
    gp.current = null;
    gp.autoplay = false;
    gp.stopProcess();
    gp.player.stop(true);
    void this.clearNowPlaying(guildId);
    void this.clearStoredQueue(guildId);
  }

  async disconnect(guildId: string): Promise<void> {
    const gp = this.players.get(guildId);
    if (gp) {
      await this.saveQueue(guildId);
      gp.queue.length = 0;
      gp.current = null;
      gp.stopProcess();
      gp.player.stop(true);
      gp.connection.destroy();
    }
    this.players.delete(guildId);
    void this.clearNowPlaying(guildId);
  }

  async volume(guildId: string, volume: number): Promise<number> {
    const gp = this.requirePlayer(guildId);
    const value = Math.max(0, Math.min(150, Math.trunc(volume)));
    gp.volume = value;
    gp.resource?.volume?.setVolume(value / 100);
    return value;
  }

  async seek(guildId: string, positionMs: number): Promise<void> {
    const gp = this.requirePlayer(guildId);
    if (!gp.current) throw new UserError("Nothing is playing.");
    const max = gp.current.isStream || gp.current.length <= 0 ? Number.MAX_SAFE_INTEGER : Math.max(0, gp.current.length - 1_000);
    const target = Math.min(max, Math.max(0, Math.floor(positionMs)));
    await gp.playNow(gp.current, target);
  }

  async loop(guildId: string, mode: MusicLoopMode): Promise<void> {
    const gp = this.requirePlayer(guildId);
    gp.loop = mode;
  }

  async shuffle(guildId: string): Promise<void> {
    const gp = this.requirePlayer(guildId);
    for (let i = gp.queue.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [gp.queue[i], gp.queue[j]] = [gp.queue[j]!, gp.queue[i]!];
    }
    void this.saveQueue(guildId);
    this.prefetchAround(gp);
  }

  async remove(guildId: string, index: number): Promise<QueueTrack> {
    const gp = this.requirePlayer(guildId);
    const [removed] = gp.queue.splice(index - 1, 1);
    if (!removed) throw new UserError("Invalid queue index.");
    void this.saveQueue(guildId);
    this.prefetchAround(gp);
    return removed;
  }

  async clear(guildId: string): Promise<void> {
    const gp = this.requirePlayer(guildId);
    gp.queue.length = 0;
    void this.saveQueue(guildId);
  }

  async move(guildId: string, from: number, to: number): Promise<void> {
    const gp = this.requirePlayer(guildId);
    const [track] = gp.queue.splice(from - 1, 1);
    if (!track) throw new UserError("Invalid source index.");
    const target = Math.max(0, Math.min(gp.queue.length, to - 1));
    gp.queue.splice(target, 0, track);
    void this.saveQueue(guildId);
    this.prefetchAround(gp);
  }

  async jump(guildId: string, index: number): Promise<void> {
    const gp = this.requirePlayer(guildId);
    const [track] = gp.queue.splice(index - 1, 1);
    if (!track) throw new UserError("Invalid queue index.");
    await gp.playNow(track);
  }

  async autoplay(guildId: string, enabled: boolean): Promise<void> {
    const gp = this.requirePlayer(guildId);
    gp.autoplay = enabled;
  }

  async filters(guildId: string, preset: MusicFilterPreset): Promise<void> {
    const gp = this.requirePlayer(guildId);
    gp.filterPreset = preset;
    if (!gp.current) return;
    const applied = await gp.applyFilterLive();
    if (!applied) {
      this.logger.debug({ guildId, preset }, "live filter unavailable; restarting stream at current position");
      await gp.playNow(gp.current, gp.positionMs());
    }
  }

  state(guildId: string): MusicQueueState | null {
    return this.players.get(guildId)?.state() ?? null;
  }

  async health(): Promise<boolean> {
    return this.isUp();
  }

  async shutdown(): Promise<void> {
    for (const guildId of [...this.players.keys()]) {
      await this.disconnect(guildId).catch(() => undefined);
    }
  }
}
