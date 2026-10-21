import { EventEmitter } from "node:events";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, rmSync, type ReadStream } from "node:fs";
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
import { ChannelType, type Client, type GuildMember } from "discord.js";
import { eq } from "drizzle-orm";
import { musicSessions, type Database } from "@siela/db";
import type { MusicLoopMode, MusicQueueState, MusicTrackInfo } from "@siela/shared";
import { UserError, ServiceUnavailableError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import type { SettingsService } from "./settings.js";

const execFileAsync = promisify(execFile);

export interface MusicServiceOptions {
  backend: "mpv" | "ffmpeg";
  ytdlpPath: string;
  mpvPath: string;
  ffmpegPath: string;
  settings: SettingsService;
  db: Database;
}

export interface QueueTrack {
  url: string;
  title: string;
  author: string;
  length: number;
  isStream: boolean;
  artworkUrl: string | null;
}

interface PersistedMusicState {
  current: QueueTrack | null;
  queue: QueueTrack[];
  volume: number;
  loop: MusicLoopMode;
  autoplay: boolean;
}

interface ResolvedTrack {
  url: string;
  title: string;
  author: string;
  length: number;
  isStream: boolean;
  artworkUrl: string | null;
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

export function isPlaylistUrl(query: string): boolean {
  return (
    /[?&]list=/i.test(query) ||
    /music\.youtube\.com\/playlist/i.test(query) ||
    /(?:youtube\.com|youtu\.be)\/playlist/i.test(query)
  );
}

class GuildPlayer {
  readonly queue: QueueTrack[] = [];
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
  resource: AudioResource | null = null;
  private startedAt = 0;
  private pausedAt: number | null = null;
  private advancing = false;

  constructor(
    readonly guildId: string,
    readonly connection: VoiceConnection,
    readonly player: AudioPlayer,
    private readonly service: MusicService,
  ) {
    this.player.on(AudioPlayerStatus.Idle, () => {
      if (!this.advancing) void this.advance();
    });
    this.player.on("error", (error) => {
      this.service.logger.warn({ err: error, guildId: this.guildId }, "audio player error");
      if (!this.advancing) void this.advance();
    });
    this.connection.on(VoiceConnectionStatus.Disconnected, () => {
      this.service.logger.warn({ guildId: this.guildId }, "voice connection disconnected");
      void this.service.disconnect(this.guildId, false);
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
  }

  stopProcess(): void {
    this.killProcesses();
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
          "bestaudio/best",
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

  private async startMpv(track: QueueTrack): Promise<AudioResource> {
    const filter = this.audioFilter();
    const directUrl = await this.directAudioUrl(track);
    const fifoPath = `/tmp/siela-${this.guildId}-${randomUUID()}.pcm`;
    await execFileAsync("mkfifo", [fifoPath], { timeout: 5_000 });
    this.fifoPath = fifoPath;

    let stderr = "";
    const mpv = spawn(
      this.service.mpvPath,
      [
        "--no-config",
        "--no-video",
        "--no-terminal",
        "--really-quiet",
        "--ao=pcm",
        `--ao-pcm-file=${fifoPath}`,
        "--ao-pcm-waveheader=no",
        "--audio-format=s16",
        "--audio-samplerate=48000",
        "--audio-channels=stereo",
        "--ytdl=no",
        ...(filter ? [`--af=${filter}`] : []),
        "--",
        directUrl,
      ],
      { cwd: "/tmp", env: { ...process.env, XDG_CACHE_HOME: "/tmp" }, stdio: ["ignore", "ignore", "pipe"] },
    );
    this.mpvProcess = mpv;
    mpv.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 4_000) stderr = stderr.slice(-4_000);
    });
    mpv.on("error", (error) => {
      this.service.logger.warn({ err: error, guildId: this.guildId }, "mpv spawn failed");
    });
    mpv.on("close", (code) => {
      if (code && code !== 0) {
        this.service.logger.warn({ code, guildId: this.guildId, stderr: stderr.slice(-500) }, "mpv exited with an error");
      }
    });

    const stream = createReadStream(fifoPath);
    this.fifoStream = stream;
    stream.on("error", (error) => {
      this.service.logger.debug({ err: error, guildId: this.guildId }, "mpv FIFO read stream closed");
    });
    return createAudioResource(stream, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });
  }

  private startFfmpeg(track: QueueTrack): AudioResource {
    const filter = this.audioFilter();
    const ytdlp = spawn(
      this.service.ytdlpPath,
      [
        "--js-runtimes",
        "node",
        "--no-part",
        "--no-cache-dir",
        "-f",
        "bestaudio/best",
        "-o",
        "-",
        "--no-playlist",
        "--no-warnings",
        "--quiet",
        track.url,
      ],
      { cwd: "/tmp", stdio: ["ignore", "pipe", "pipe"] },
    );
    const ffmpeg = spawn(
      this.service.ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        ...(filter ? ["-af", filter] : []),
        "-f",
        "s16le",
        "-ar",
        "48000",
        "-ac",
        "2",
        "pipe:1",
      ],
      { cwd: "/tmp", stdio: ["pipe", "pipe", "pipe"] },
    );
    this.ytdlpProcess = ytdlp;
    this.ffmpegProcess = ffmpeg;

    ytdlp.stdout?.on("error", (error) => {
      this.service.logger.debug({ err: error, guildId: this.guildId }, "yt-dlp stdout closed");
    });
    ytdlp.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) this.service.logger.debug({ guildId: this.guildId, ytdlp: text.slice(0, 200) }, "yt-dlp");
    });
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
    ytdlp.on("error", (error) => {
      this.service.logger.warn({ err: error, guildId: this.guildId }, "yt-dlp spawn failed");
    });
    ffmpeg.on("error", (error) => {
      this.service.logger.warn({ err: error, guildId: this.guildId }, "ffmpeg spawn failed");
    });
    ytdlp.stdout?.pipe(ffmpeg.stdin!);
    return createAudioResource(ffmpeg.stdout!, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });
  }

  async playNow(track: QueueTrack): Promise<void> {
    this.killProcesses();
    this.current = track;
    this.startedAt = Date.now();
    this.pausedAt = null;
    this.paused = false;

    const resource =
      this.service.backend === "ffmpeg" ? this.startFfmpeg(track) : await this.startMpv(track);
    this.resource = resource;
    resource.volume?.setVolume(this.volume / 100);
    this.player.play(resource);
    this.service.emit("trackStart", { guildId: this.guildId, track: toInfo(track) });
    this.service.schedulePersist(this.guildId);
  }

  async advance(): Promise<void> {
    if (this.advancing) return;
    this.advancing = true;
    try {
      if (this.loop === "track" && this.current) {
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
      this.service.schedulePersist(this.guildId);
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
  private readonly persistTimers = new Map<string, NodeJS.Timeout>();
  private binariesCheckedAt = 0;
  private binariesOk = false;

  constructor(
    private readonly client: Client,
    private readonly options: MusicServiceOptions,
    logger: Logger,
  ) {
    super();
    this.logger = logger;
    this.on("error", () => undefined);
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

  schedulePersist(guildId: string): void {
    const existing = this.persistTimers.get(guildId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.persistTimers.delete(guildId);
      void this.persist(guildId);
    }, 750);
    timer.unref?.();
    this.persistTimers.set(guildId, timer);
  }

  private async persist(guildId: string): Promise<void> {
    const gp = this.players.get(guildId);
    if (!gp) return;
    const state: PersistedMusicState = {
      current: gp.current,
      queue: gp.queue,
      volume: gp.volume,
      loop: gp.loop,
      autoplay: gp.autoplay,
    };
    try {
      await this.options.db
        .insert(musicSessions)
        .values({ guildId, state, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: musicSessions.guildId,
          set: { state, updatedAt: new Date() },
        });
    } catch (error) {
      this.logger.warn({ err: error, guildId }, "failed to persist music state");
    }
  }

  private async loadPersisted(guildId: string): Promise<PersistedMusicState | null> {
    try {
      const [row] = await this.options.db
        .select()
        .from(musicSessions)
        .where(eq(musicSessions.guildId, guildId))
        .limit(1);
      return (row?.state as PersistedMusicState | undefined) ?? null;
    } catch (error) {
      this.logger.debug({ err: error, guildId }, "failed to load music state");
      return null;
    }
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

  private async resolve(query: string, limit = 5): Promise<ResolvedTrack[]> {
    let target = query.trim();
    if (/open\.spotify\.com\//i.test(target)) {
      const search = await this.spotifyToSearch(target);
      if (!search) {
        throw new UserError("Could not read that Spotify link. Try a SoundCloud link or a search.");
      }
      target = search;
    }
    const isUrl = /^https?:\/\//i.test(target);
    const playlist = isUrl && isPlaylistUrl(target);
    const args = isUrl
      ? playlist
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
          "--default-search",
          "scsearch",
          "--playlist-end",
          String(Math.max(1, Math.min(limit, 10))),
          target,
        ];
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
    const tracks: ResolvedTrack[] = [];
    for (const entry of entries) {
      const url = (entry.webpage_url ?? entry.url) as string | undefined;
      if (!url) continue;
      tracks.push({
        url,
        title: (entry.title as string) ?? "Unknown title",
        author: ((entry.uploader ?? entry.channel ?? entry.artist) as string) ?? "Unknown artist",
        length: Number(entry.duration ?? 0) * 1000,
        isStream: Boolean(entry.is_live),
        artworkUrl: (entry.thumbnail as string) ?? null,
      });
    }
    if (!tracks.length) throw new UserError("No tracks found for that search.", "no_tracks");
    return tracks;
  }

  private async ensurePlayer(member: GuildMember, voiceChannelId?: string): Promise<GuildPlayer> {
    const channelId = voiceChannelId ?? member.voice.channelId;
    if (!channelId) throw new UserError("Join a voice channel first.");
    const channel = member.guild.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) throw new UserError("That is not a voice channel.");
    const existing = this.players.get(member.guild.id);
    if (existing && existing.connection.joinConfig.channelId === channelId) return existing;
    if (existing) await this.disconnect(member.guild.id, false);

    const connection = joinVoiceChannel({
      channelId,
      guildId: member.guild.id,
      adapterCreator: member.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (error) {
      connection.destroy();
      this.logger.warn({ err: error, guildId: member.guild.id }, "voice connection failed");
      throw new ServiceUnavailableError("Could not join the voice channel.");
    }
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    connection.subscribe(player);
    const guildPlayer = new GuildPlayer(member.guild.id, connection, player, this);
    const musicSettings = await this.options.settings.getMusic(member.guild.id);
    const persisted = await this.loadPersisted(member.guild.id);
    if (persisted) {
      guildPlayer.queue.push(...(persisted.queue ?? []));
      guildPlayer.loop = persisted.loop ?? "off";
      guildPlayer.autoplay = persisted.autoplay ?? false;
      guildPlayer.volume = persisted.volume ?? musicSettings.defaultVolume;
    } else {
      guildPlayer.volume = musicSettings.defaultVolume;
    }
    this.players.set(member.guild.id, guildPlayer);
    if (persisted?.current) {
      await guildPlayer.playNow(persisted.current).catch((error) => {
        this.logger.warn({ err: error, guildId: member.guild.id }, "failed to restore persisted track");
      });
    }
    return guildPlayer;
  }

  async play(
    member: GuildMember,
    query: string,
    voiceChannelId?: string,
    next = false,
  ): Promise<{ added: number; first: MusicTrackInfo }> {
    const guildPlayer = await this.ensurePlayer(member, voiceChannelId);
    const settings = await this.options.settings.getMusic(member.guild.id);
    const resolved = await this.resolve(query, settings.maxQueueSize);
    const available = Math.max(0, settings.maxQueueSize - guildPlayer.queue.length - (guildPlayer.current ? 1 : 0));
    const accepted = resolved.slice(0, available);
    if (!accepted.length) throw new UserError("The queue is full.");
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
    this.schedulePersist(member.guild.id);
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
    await gp.advance();
  }

  async stop(guildId: string): Promise<void> {
    const gp = this.players.get(guildId);
    if (!gp) return;
    gp.queue.length = 0;
    gp.current = null;
    gp.autoplay = false;
    gp.stopProcess();
    gp.player.stop(true);
    this.schedulePersist(guildId);
  }

  async disconnect(guildId: string, persist = true): Promise<void> {
    const gp = this.players.get(guildId);
    if (persist) this.schedulePersist(guildId);
    if (gp) {
      gp.stopProcess();
      gp.player.stop(true);
      gp.connection.destroy();
    }
    this.players.delete(guildId);
  }

  async volume(guildId: string, volume: number): Promise<number> {
    const gp = this.requirePlayer(guildId);
    const value = Math.max(0, Math.min(150, Math.trunc(volume)));
    gp.volume = value;
    gp.resource?.volume?.setVolume(value / 100);
    this.schedulePersist(guildId);
    return value;
  }

  async seek(): Promise<void> {
    throw new UserError("Seek is not supported with the yt-dlp stream backend.");
  }

  async loop(guildId: string, mode: MusicLoopMode): Promise<void> {
    const gp = this.requirePlayer(guildId);
    gp.loop = mode;
    this.schedulePersist(guildId);
  }

  async shuffle(guildId: string): Promise<void> {
    const gp = this.requirePlayer(guildId);
    for (let i = gp.queue.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [gp.queue[i], gp.queue[j]] = [gp.queue[j]!, gp.queue[i]!];
    }
    this.schedulePersist(guildId);
  }

  async remove(guildId: string, index: number): Promise<QueueTrack> {
    const gp = this.requirePlayer(guildId);
    const [removed] = gp.queue.splice(index - 1, 1);
    if (!removed) throw new UserError("Invalid queue index.");
    this.schedulePersist(guildId);
    return removed;
  }

  async clear(guildId: string): Promise<void> {
    const gp = this.requirePlayer(guildId);
    gp.queue.length = 0;
    this.schedulePersist(guildId);
  }

  async move(guildId: string, from: number, to: number): Promise<void> {
    const gp = this.requirePlayer(guildId);
    const [track] = gp.queue.splice(from - 1, 1);
    if (!track) throw new UserError("Invalid source index.");
    const target = Math.max(0, Math.min(gp.queue.length, to - 1));
    gp.queue.splice(target, 0, track);
    this.schedulePersist(guildId);
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
    this.schedulePersist(guildId);
  }

  async filters(guildId: string, preset: "off" | "bassboost" | "nightcore" | "vaporwave"): Promise<void> {
    const gp = this.requirePlayer(guildId);
    gp.filterPreset = preset;
    if (gp.current) await gp.playNow(gp.current);
    this.schedulePersist(guildId);
  }

  state(guildId: string): MusicQueueState | null {
    return this.players.get(guildId)?.state() ?? null;
  }

  async health(): Promise<boolean> {
    return this.isUp();
  }

  async shutdown(): Promise<void> {
    for (const guildId of [...this.players.keys()]) {
      await this.disconnect(guildId, false).catch(() => undefined);
    }
  }
}
