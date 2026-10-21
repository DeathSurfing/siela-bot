import { EventEmitter } from "node:events";
import { ChannelType, type Client, type GuildMember } from "discord.js";
import { eq } from "drizzle-orm";
import { musicSessions, type Database } from "@siela/db";
import {
  Connectors,
  Constants,
  LoadType,
  Shoukaku,
  type Player,
  type Track,
} from "shoukaku";
import { UserError, ServiceUnavailableError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import type { SettingsService } from "./settings.js";
import type { MusicLoopMode, MusicQueueState, MusicTrackInfo } from "@siela/shared";

export interface MusicServiceOptions {
  url: string;
  password: string;
  guildId: string;
  settings: SettingsService;
  db: Database;
}

interface PersistedMusicState {
  current: Track | null;
  queue: Track[];
  volume: number;
  loop: MusicLoopMode;
  autoplay: boolean;
}

function trackInfo(track: Track): MusicTrackInfo {
  return {
    title: track.info.title,
    author: track.info.author,
    length: track.info.length,
    uri: track.info.uri ?? null,
    artworkUrl: track.info.artworkUrl ?? null,
    isStream: track.info.isStream,
  };
}

class GuildPlayer {
  readonly queue: Track[] = [];
  current: Track | null = null;
  loop: MusicLoopMode = "off";
  autoplay = false;
  volume = 80;

  constructor(
    readonly guildId: string,
    readonly player: Player,
    private readonly service: MusicService,
  ) {
    player.on("start", (data) => {
      this.current = data.track;
      this.service.emit("trackStart", { guildId: this.guildId, track: data.track });
    });
    player.on("end", (data) => {
      if (data.reason === "replaced" || data.reason === "stopped" || data.reason === "cleanup") return;
      void this.advance();
    });
    player.on("exception", (data) => {
      this.service.logger.warn({ guildId: this.guildId, exception: data.exception }, "track exception");
      this.service.emit("error", { guildId: this.guildId, error: data.exception.message });
      void this.advance();
    });
    player.on("stuck", (data) => {
      this.service.logger.warn({ guildId: this.guildId, track: data.track.info.title }, "track stuck");
      void this.advance();
    });
    player.on("closed", (data) => {
      this.service.logger.warn({ guildId: this.guildId, code: data.code, reason: data.reason }, "voice websocket closed");
    });
  }

  async playNow(track: Track): Promise<void> {
    this.current = track;
    await this.player.playTrack({ track: { encoded: track.encoded }, volume: this.volume });
    this.service.schedulePersist(this.guildId);
  }

  async advance(): Promise<void> {
    if (this.loop === "track" && this.current) {
      await this.playNow(this.current);
      return;
    }
    if (this.loop === "queue" && this.current) this.queue.push(this.current);
    const next = this.queue.shift();
    if (next) {
      await this.playNow(next);
      return;
    }
    const previous = this.current;
    this.current = null;
    if (this.autoplay) {
      const related = await this.service.autoplayTrack(this.guildId, previous);
      if (related) {
        await this.playNow(related);
        return;
      }
    }
    await this.player.stopTrack().catch(() => undefined);
    this.service.schedulePersist(this.guildId);
    this.service.emit("queueEnd", { guildId: this.guildId });
  }

  state(): MusicQueueState {
    return {
      playing: Boolean(this.current),
      paused: this.player.paused,
      volume: this.volume,
      loop: this.loop,
      position: this.player.position,
      current: this.current ? trackInfo(this.current) : null,
      upcoming: this.queue.map(trackInfo),
    };
  }
}

export class MusicService extends EventEmitter {
  readonly logger: Logger;
  readonly shoukaku: Shoukaku;
  private readonly players = new Map<string, GuildPlayer>();
  private readonly persistTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly client: Client,
    private readonly options: MusicServiceOptions,
    logger: Logger,
  ) {
    super();
    this.logger = logger;
    this.on("error", () => undefined);
    const parsed = new URL(options.url);
    const nodeUrl = parsed.host;
    this.shoukaku = new Shoukaku(
      new Connectors.DiscordJS(client),
      [{ name: "siela", url: nodeUrl, auth: options.password, secure: parsed.protocol === "https:" }],
      {
        resume: true,
        resumeTimeout: 60,
        reconnectTries: 10,
        reconnectInterval: 5_000,
        moveOnDisconnect: true,
        restTimeout: 15_000,
      },
    );
    this.shoukaku.on("ready", (name) => this.logger.info({ node: name }, "Lavalink node ready"));
    this.shoukaku.on("error", (name, error) => this.logger.error({ node: name, err: error }, "Lavalink node error"));
    this.shoukaku.on("close", (name, code, reason) => this.logger.warn({ node: name, code, reason }, "Lavalink node closed"));
    this.shoukaku.on("disconnect", (name, count) => this.logger.warn({ node: name, count }, "Lavalink node disconnected"));
  }

  isUp(): boolean {
    return [...this.shoukaku.nodes.values()].some((node) => node.state === Constants.State.CONNECTED);
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

  async autoplayTrack(guildId: string, previous: Track | null): Promise<Track | null> {
    if (!previous) return null;
    try {
      const node = this.shoukaku.getIdealNode();
      if (!node) return null;
      const response = await node.rest.resolve(`scsearch:${previous.info.author} ${previous.info.title}`);
      if (!response || response.loadType !== LoadType.SEARCH) return null;
      return response.data[0] ?? null;
    } catch (error) {
      this.logger.debug({ err: error, guildId }, "autoplay search failed");
      return null;
    }
  }

  private async resolve(query: string): Promise<Track[]> {
    const node = this.shoukaku.getIdealNode();
    if (!node) throw new ServiceUnavailableError("The music service is not available right now.");
    let identifier = query.trim();
    if (!/^https?:\/\//i.test(identifier) && !/^(scsearch|spsearch|ytsearch|ytmsearch):/i.test(identifier)) {
      identifier = `scsearch:${identifier}`;
    }
    const response = await node.rest.resolve(identifier);
    if (!response || response.loadType === LoadType.EMPTY) {
      throw new UserError("No tracks found for that search.", "no_tracks");
    }
    if (response.loadType === LoadType.ERROR) {
      throw new UserError(response.data.message || "Lavalink could not load that track.", "load_failed");
    }
    if (response.loadType === LoadType.TRACK) return [response.data];
    if (response.loadType === LoadType.PLAYLIST) return response.data.tracks;
    if (response.loadType === LoadType.SEARCH) return response.data;
    return [];
  }

  private async ensurePlayer(member: GuildMember, voiceChannelId?: string): Promise<GuildPlayer> {
    const channelId = voiceChannelId ?? member.voice.channelId;
    if (!channelId) throw new UserError("Join a voice channel first.");
    const channel = member.guild.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) throw new UserError("That is not a voice channel.");
    const existing = this.players.get(member.guild.id);
    if (existing) {
      const currentChannel = this.shoukaku.connections.get(member.guild.id)?.channelId;
      if (currentChannel === channelId) return existing;
      await this.shoukaku.leaveVoiceChannel(member.guild.id).catch(() => undefined);
      this.players.delete(member.guild.id);
    }
    const player = await this.shoukaku.joinVoiceChannel({
      guildId: member.guild.id,
      channelId,
      shardId: member.guild.shardId,
      deaf: true,
    });
    const guildPlayer = new GuildPlayer(member.guild.id, player, this);
    const musicSettings = await this.options.settings.getMusic(member.guild.id);
    const persisted = await this.loadPersisted(member.guild.id);
    if (persisted) {
      guildPlayer.queue.push(...(persisted.queue ?? []));
      guildPlayer.loop = persisted.loop ?? "off";
      guildPlayer.autoplay = persisted.autoplay ?? false;
      guildPlayer.volume = persisted.volume ?? musicSettings.defaultVolume;
      await player.setGlobalVolume(guildPlayer.volume);
      this.players.set(member.guild.id, guildPlayer);
      if (persisted.current) {
        await guildPlayer.playNow(persisted.current).catch((error) => {
          this.logger.warn({ err: error, guildId: member.guild.id }, "failed to restore persisted track");
        });
      }
    } else {
      guildPlayer.volume = musicSettings.defaultVolume;
      await player.setGlobalVolume(musicSettings.defaultVolume);
      this.players.set(member.guild.id, guildPlayer);
    }
    return guildPlayer;
  }

  async play(member: GuildMember, query: string, voiceChannelId?: string, next = false): Promise<{ added: number; first: MusicTrackInfo }> {
    const guildPlayer = await this.ensurePlayer(member, voiceChannelId);
    const tracks = await this.resolve(query);
    if (!tracks.length) throw new UserError("No tracks found for that search.", "no_tracks");
    const settings = await this.options.settings.getMusic(member.guild.id);
    const available = Math.max(0, settings.maxQueueSize - guildPlayer.queue.length - (guildPlayer.current ? 1 : 0));
    const accepted = tracks.slice(0, available);
    if (!accepted.length) throw new UserError("The queue is full.");
    if (next) {
      guildPlayer.queue.unshift(...accepted);
    } else {
      guildPlayer.queue.push(...accepted);
    }
    if (!guildPlayer.current) {
      const first = guildPlayer.queue.shift()!;
      await guildPlayer.playNow(first);
      return { added: accepted.length, first: trackInfo(first) };
    }
    this.schedulePersist(member.guild.id);
    return { added: accepted.length, first: trackInfo(accepted[0]!) };
  }

  async pause(guildId: string): Promise<void> {
    const gp = this.players.get(guildId);
    if (!gp?.current) throw new UserError("Nothing is playing.");
    await gp.player.setPaused(true);
  }

  async resume(guildId: string): Promise<void> {
    const gp = this.players.get(guildId);
    if (!gp?.current) throw new UserError("Nothing is playing.");
    await gp.player.setPaused(false);
  }

  async skip(guildId: string, count = 1): Promise<void> {
    const gp = this.players.get(guildId);
    if (!gp?.current) throw new UserError("Nothing is playing.");
    if (count > 1) {
      gp.queue.splice(0, Math.max(0, count - 1));
    }
    await gp.advance();
    this.schedulePersist(guildId);
  }

  async stop(guildId: string): Promise<void> {
    const gp = this.players.get(guildId);
    if (!gp) return;
    gp.queue.length = 0;
    gp.current = null;
    gp.autoplay = false;
    await gp.player.stopTrack().catch(() => undefined);
    this.schedulePersist(guildId);
  }

  async disconnect(guildId: string): Promise<void> {
    this.schedulePersist(guildId);
    this.players.delete(guildId);
    await this.shoukaku.leaveVoiceChannel(guildId).catch(() => undefined);
  }

  async volume(guildId: string, volume: number): Promise<number> {
    const gp = this.players.get(guildId);
    if (!gp) throw new UserError("The bot is not playing anything.");
    const value = Math.max(0, Math.min(150, Math.trunc(volume)));
    gp.volume = value;
    await gp.player.setGlobalVolume(value);
    this.schedulePersist(guildId);
    return value;
  }

  async seek(guildId: string, positionMs: number): Promise<void> {
    const gp = this.players.get(guildId);
    if (!gp?.current) throw new UserError("Nothing is playing.");
    await gp.player.seekTo(Math.max(0, Math.trunc(positionMs)));
  }

  async loop(guildId: string, mode: MusicLoopMode): Promise<void> {
    const gp = this.players.get(guildId);
    if (!gp) throw new UserError("The bot is not playing anything.");
    gp.loop = mode;
    this.schedulePersist(guildId);
  }

  async shuffle(guildId: string): Promise<void> {
    const gp = this.players.get(guildId);
    if (!gp) throw new UserError("The bot is not playing anything.");
    for (let i = gp.queue.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [gp.queue[i], gp.queue[j]] = [gp.queue[j]!, gp.queue[i]!];
    }
    this.schedulePersist(guildId);
  }

  async remove(guildId: string, index: number): Promise<Track> {
    const gp = this.players.get(guildId);
    if (!gp) throw new UserError("The bot is not playing anything.");
    const [removed] = gp.queue.splice(index - 1, 1);
    if (!removed) throw new UserError("Invalid queue index.");
    this.schedulePersist(guildId);
    return removed;
  }

  async clear(guildId: string): Promise<void> {
    const gp = this.players.get(guildId);
    if (!gp) throw new UserError("The bot is not playing anything.");
    gp.queue.length = 0;
    this.schedulePersist(guildId);
  }

  async move(guildId: string, from: number, to: number): Promise<void> {
    const gp = this.players.get(guildId);
    if (!gp) throw new UserError("The bot is not playing anything.");
    const [track] = gp.queue.splice(from - 1, 1);
    if (!track) throw new UserError("Invalid source index.");
    const target = Math.max(0, Math.min(gp.queue.length, to - 1));
    gp.queue.splice(target, 0, track);
    this.schedulePersist(guildId);
  }

  async jump(guildId: string, index: number): Promise<void> {
    const gp = this.players.get(guildId);
    if (!gp) throw new UserError("The bot is not playing anything.");
    const [track] = gp.queue.splice(index - 1, 1);
    if (!track) throw new UserError("Invalid queue index.");
    await gp.playNow(track);
    this.schedulePersist(guildId);
  }

  async autoplay(guildId: string, enabled: boolean): Promise<void> {
    const gp = this.players.get(guildId);
    if (!gp) throw new UserError("The bot is not playing anything.");
    gp.autoplay = enabled;
    this.schedulePersist(guildId);
  }

  async filters(guildId: string, preset: "off" | "bassboost" | "nightcore" | "vaporwave"): Promise<void> {
    const gp = this.players.get(guildId);
    if (!gp) throw new UserError("The bot is not playing anything.");
    await gp.player.setEqualizer([]);
    await gp.player.setTimescale({});
    await gp.player.setTremolo({});
    await gp.player.setVibrato({});
    if (preset === "bassboost") {
      await gp.player.setEqualizer([
        { band: 0, gain: 0.2 },
        { band: 1, gain: 0.15 },
        { band: 2, gain: 0.1 },
        { band: 3, gain: 0.05 },
      ]);
    } else if (preset === "nightcore") {
      await gp.player.setTimescale({ speed: 1.2, pitch: 1.2, rate: 1 });
    } else if (preset === "vaporwave") {
      await gp.player.setTimescale({ speed: 0.8, pitch: 0.8, rate: 1 });
    }
    this.schedulePersist(guildId);
  }

  state(guildId: string): MusicQueueState | null {
    return this.players.get(guildId)?.state() ?? null;
  }

  async health(): Promise<boolean> {
    return this.isUp();
  }
}
