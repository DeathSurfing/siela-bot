import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
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
  getVoiceConnection,
  joinVoiceChannel,
  type AudioPlayer,
  type VoiceConnection,
} from "@discordjs/voice";
import {
  ChannelType,
  PermissionFlagsBits,
  type GuildMember,
  type Message,
  type VoiceChannel,
} from "discord.js";
import type { Logger } from "../lib/logger.js";

const execFileAsync = promisify(execFile);

const CACHE_DIR = "/tmp/siela-sfx-cache";
const GUILD_COOLDOWN_MS = 60_000;
const PLAYBACK_LIMIT_MS = 30_000;

export interface VoiceSfxTrigger {
  /** Lowercase word that fires the effect when it appears as a whole word. */
  word: string;
  /** Stable id, also used as the cache filename prefix. */
  id: string;
  url: string;
  title: string;
  /** Upper bound for the download and the stored encode. */
  bitrateKbps: number;
}

export const VOICE_SFX_TRIGGERS: readonly VoiceSfxTrigger[] = [
  {
    word: "gay",
    id: "gay-echo",
    url: "https://www.youtube.com/watch?v=dp3kXdkjegI",
    title: "Gay Echo sound effect",
    bitrateKbps: 384,
  },
];

export function matchVoiceSfx(content: string): VoiceSfxTrigger | null {
  const words = content.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!words) return null;
  return VOICE_SFX_TRIGGERS.find((trigger) => words.includes(trigger.word)) ?? null;
}

export interface VoiceSfxOptions {
  ytdlpPath: string;
  ffmpegPath: string;
  logger: Logger;
  /** True when the bot is already doing something in a voice channel. */
  isVoiceBusy: (guildId: string) => boolean;
}

/**
 * Plays a short sound effect in the author's voice channel when a trigger word
 * is typed. The bot only joins when it is idle, plays once, then leaves.
 */
export class VoiceSfxService {
  private readonly downloads = new Map<string, Promise<string>>();
  private readonly lastPlayedAt = new Map<string, number>();
  private readonly inFlight = new Set<string>();
  private connection: VoiceConnection | null = null;
  private player: AudioPlayer | null = null;
  private ffmpeg: ChildProcess | null = null;

  constructor(private readonly options: VoiceSfxOptions) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }

  async maybePlay(message: Message): Promise<void> {
    const trigger = matchVoiceSfx(message.content);
    if (!trigger) return;
    if (!message.inGuild()) return;
    const member =
      message.member ??
      (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (!member) return;
    const guildId = member.guild.id;
    if (!member.voice.channelId) return;
    if (this.inFlight.has(guildId)) return;
    if (member.guild.members.me?.voice.channelId) return;
    if (this.options.isVoiceBusy(guildId)) return;
    if (getVoiceConnection(guildId)) return;

    const last = this.lastPlayedAt.get(guildId) ?? 0;
    if (Date.now() - last < GUILD_COOLDOWN_MS) return;

    this.lastPlayedAt.set(guildId, Date.now());
    this.inFlight.add(guildId);
    try {
      const channel = await this.voiceChannel(member);
      if (!channel) return;
      await this.play(member, channel, trigger);
    } catch (error) {
      this.options.logger.warn({ err: error, guildId, trigger: trigger.word }, "voice sfx failed");
    } finally {
      this.inFlight.delete(guildId);
    }
  }

  private async voiceChannel(member: GuildMember): Promise<VoiceChannel | null> {
    const channelId = member.voice.channelId;
    if (!channelId) return null;
    const channel =
      member.guild.channels.cache.get(channelId) ??
      (await member.guild.channels.fetch(channelId).catch(() => null));
    if (!channel || channel.type !== ChannelType.GuildVoice) return null;
    const me = member.guild.members.me ?? (await member.guild.members.fetchMe().catch(() => null));
    const permissions = me ? channel.permissionsFor(me) : null;
    if (!permissions?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) return null;
    return channel;
  }

  private async play(
    member: GuildMember,
    channel: VoiceChannel,
    trigger: VoiceSfxTrigger,
  ): Promise<void> {
    const guildId = member.guild.id;
    const file = await this.audioFile(trigger);
    if (getVoiceConnection(guildId) || this.options.isVoiceBusy(guildId)) return;

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId,
      adapterCreator: member.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    this.connection = connection;
    connection.on("error", (error) => {
      this.options.logger.warn({ err: error, guildId }, "voice sfx connection error");
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

      const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
      this.player = player;
      player.on("error", (error) => {
        this.options.logger.warn({ err: error, guildId }, "voice sfx player error");
      });
      connection.subscribe(player);

      const ffmpeg = spawn(
        this.options.ffmpegPath,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          file,
          "-f",
          "s16le",
          "-ar",
          "48000",
          "-ac",
          "2",
          "pipe:1",
        ],
        { cwd: "/tmp", stdio: ["ignore", "pipe", "pipe"] },
      );
      this.ffmpeg = ffmpeg;
      ffmpeg.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text) this.options.logger.debug({ guildId, ffmpeg: text.slice(0, 200) }, "voice sfx ffmpeg");
      });
      ffmpeg.stdout?.on("error", () => undefined);
      ffmpeg.on("error", (error) => {
        this.options.logger.warn({ err: error, guildId }, "voice sfx ffmpeg spawn failed");
      });

      const resource = createAudioResource(ffmpeg.stdout!, {
        inputType: StreamType.Raw,
        inlineVolume: true,
      });
      resource.volume?.setVolume(0.9);

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, PLAYBACK_LIMIT_MS);
        timer.unref?.();
        const done = (): void => {
          clearTimeout(timer);
          resolve();
        };
        player.once(AudioPlayerStatus.Idle, done);
        player.once("error", done);
        player.play(resource);
      });

      this.options.logger.info(
        { guildId, channelId: channel.id, trigger: trigger.word, title: trigger.title },
        "voice sfx played",
      );
    } finally {
      this.cleanup();
    }
  }

  private async audioFile(trigger: VoiceSfxTrigger): Promise<string> {
    const target = join(CACHE_DIR, `${trigger.id}-${trigger.bitrateKbps}k.m4a`);
    if (existsSync(target) && statSync(target).size > 0) return target;

    const pending = this.downloads.get(trigger.id);
    if (pending) return pending;

    const promise = this.download(trigger, target).finally(() => this.downloads.delete(trigger.id));
    this.downloads.set(trigger.id, promise);
    return promise;
  }

  private async download(trigger: VoiceSfxTrigger, target: string): Promise<string> {
    const template = join(CACHE_DIR, `${trigger.id}.%(ext)s`);
    const { stdout } = await execFileAsync(
      this.options.ytdlpPath,
      [
        "--js-runtimes",
        "node",
        "--no-part",
        "--no-cache-dir",
        "--no-playlist",
        "--no-warnings",
        "--quiet",
        "-f",
        `bestaudio[abr<=${trigger.bitrateKbps}]/bestaudio/best`,
        "-x",
        "--audio-format",
        "m4a",
        "--audio-quality",
        `${trigger.bitrateKbps}K`,
        "--max-filesize",
        "25M",
        "-o",
        template,
        "--print",
        "after_move:filepath",
        trigger.url,
      ],
      { cwd: CACHE_DIR, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
    );
    const printed = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (!printed || !existsSync(printed) || statSync(printed).size === 0) {
      throw new Error(`voice sfx download produced no file for ${trigger.id}`);
    }
    if (printed !== target) {
      rmSync(target, { force: true });
      renameSync(printed, target);
    }
    this.options.logger.info(
      { path: target, bitrateKbps: trigger.bitrateKbps, title: trigger.title },
      "voice sfx cached",
    );
    return target;
  }

  private cleanup(): void {
    try {
      this.ffmpeg?.kill("SIGKILL");
    } catch {
      // ignore
    }
    this.ffmpeg = null;
    try {
      this.player?.stop(true);
    } catch {
      // ignore
    }
    this.player = null;
    try {
      this.connection?.destroy();
    } catch {
      // ignore
    }
    this.connection = null;
  }

  stop(): void {
    this.cleanup();
    this.inFlight.clear();
  }
}
