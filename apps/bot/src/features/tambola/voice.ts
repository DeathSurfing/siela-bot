import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
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
import { PermissionFlagsBits, type VoiceChannel } from "discord.js";
import type { Logger } from "../../lib/logger.js";

const execFileAsync = promisify(execFile);
const DEFAULT_VOICE = "en-IN-NeerjaNeural";
const DEFAULT_RATE = "-5%";
const CACHE_DIR = "/tmp/siela-tambola-tts";
const MAX_CACHE_FILES = 300;

export interface TambolaVoiceOptions {
  voice?: string;
  rate?: string;
  cacheDir?: string;
}

export class TambolaVoice {
  private connection: VoiceConnection | null = null;
  private player: AudioPlayer | null = null;
  private readonly voice: string;
  private readonly rate: string;
  private readonly cacheDir: string;
  private synthesisChain: Promise<unknown> = Promise.resolve();
  private failures = 0;
  private synthesized = 0;
  disabled = false;

  constructor(
    private readonly logger: Logger,
    options: TambolaVoiceOptions = {},
  ) {
    this.voice = options.voice ?? DEFAULT_VOICE;
    this.rate = options.rate ?? DEFAULT_RATE;
    this.cacheDir = options.cacheDir ?? CACHE_DIR;
    mkdirSync(this.cacheDir, { recursive: true });
  }

  get connected(): boolean {
    return Boolean(
      this.connection &&
      this.player &&
      this.connection.state.status === VoiceConnectionStatus.Ready,
    );
  }

  async join(channel: VoiceChannel): Promise<boolean> {
    if (this.connection) return true;
    const me = channel.guild.members.me
      ?? await channel.guild.members.fetchMe().catch(() => null);
    const permissions = me ? channel.permissionsFor(me) : null;
    if (
      !permissions ||
      !permissions.has(PermissionFlagsBits.Connect) ||
      !permissions.has(PermissionFlagsBits.Speak)
    ) {
      this.logger.warn(
        { guildId: channel.guild.id, channelId: channel.id },
        "tambola TTS needs Connect and Speak permissions",
      );
      return false;
    }
    const existing = getVoiceConnection(channel.guild.id);
    if (existing && existing.state.status !== VoiceConnectionStatus.Destroyed) {
      this.logger.warn({ guildId: channel.guild.id }, "tambola TTS skipped because a voice connection already exists");
      return false;
    }
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    } catch (error) {
      this.logger.warn({ err: error, guildId: channel.guild.id }, "tambola voice connection failed");
      connection.destroy();
      return false;
    }

    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play },
    });
    const subscription = connection.subscribe(player);
    if (!subscription) {
      this.logger.warn({ guildId: channel.guild.id, channelId: channel.id }, "tambola audio player could not subscribe");
      connection.destroy();
      return false;
    }
    connection.on("error", (error) => {
      this.logger.warn({ err: error, guildId: channel.guild.id }, "tambola voice connection error");
    });
    player.on("error", (error) => {
      this.logger.warn({ err: error, guildId: channel.guild.id }, "tambola audio player error");
    });
    this.connection = connection;
    this.player = player;
    this.logger.info({ guildId: channel.guild.id, channelId: channel.id }, "tambola voice connected");
    return true;
  }

  async speak(text: string): Promise<void> {
    if (this.disabled || !this.connected) return;
    const file = await this.synthesize(text);
    if (!file || !this.player) return;
    try {
      if (this.player.state.status !== AudioPlayerStatus.Idle) {
        this.player.stop(true);
      }
      this.player.play(createAudioResource(createReadStream(file), { inputType: StreamType.Arbitrary }));
      this.logger.debug({ text, status: this.player.state.status }, "tambola TTS playback started");
    } catch (error) {
      this.logger.warn({ err: error }, "tambola TTS playback failed");
    }
  }

  leave(): void {
    try {
      this.player?.stop(true);
      this.connection?.destroy();
    } catch {
      // ignore voice teardown failures
    }
    this.connection = null;
    this.player = null;
  }

  private synthesize(text: string): Promise<string | null> {
    const run = this.synthesisChain.then(() => this.synthesizeNow(text));
    this.synthesisChain = run.catch(() => undefined);
    return run;
  }

  private async synthesizeNow(text: string): Promise<string | null> {
    if (this.disabled) return null;
    const key = createHash("sha1")
      .update(`${this.voice}\u0000${this.rate}\u0000${text}`)
      .digest("hex");
    const file = join(this.cacheDir, `${key}.mp3`);
    if (existsSync(file)) {
      const size = statSync(file).size;
      if (size > 0) return file;
      rmSync(file, { force: true });
    }

    const temp = join(this.cacheDir, `${key}.${randomUUID()}.tmp.mp3`);
    try {
      await execFileAsync(
        "python3",
        [
          "-m",
          "edge_tts",
          "--voice",
          this.voice,
          `--rate=${this.rate}`,
          "--text",
          text,
          "--write-media",
          temp,
        ],
        { timeout: 12_000, maxBuffer: 1024 * 1024 },
      );
      if (!existsSync(temp) || statSync(temp).size === 0) {
        throw new Error("edge-tts produced an empty file");
      }
      renameSync(temp, file);
      this.synthesized += 1;
      if (this.synthesized === 1) this.logger.info({ text }, "tambola TTS first clip ready");
      if (this.synthesized % 20 === 0) this.pruneCache();
      return file;
    } catch (error) {
      rmSync(temp, { force: true });
      this.failures += 1;
      this.logger.warn({ err: error, text, failures: this.failures }, "tambola TTS synthesis failed");
      if (this.failures >= 3) this.disabled = true;
      return null;
    }
  }

  private pruneCache(): void {
    try {
      const files = readdirSync(this.cacheDir)
        .filter((name) => name.endsWith(".mp3"))
        .map((name) => {
          const path = join(this.cacheDir, name);
          return { path, mtime: statSync(path).mtimeMs };
        })
        .sort((left, right) => left.mtime - right.mtime);
      const remove = files.length - MAX_CACHE_FILES;
      if (remove <= 0) return;
      for (const entry of files.slice(0, remove)) rmSync(entry.path, { force: true });
    } catch (error) {
      this.logger.debug({ err: error }, "tambola TTS cache prune failed");
    }
  }
}
