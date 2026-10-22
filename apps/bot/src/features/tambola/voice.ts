import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  private readonly backend: string;
  private readonly kittenScript: string;
  private readonly kittenVoice: string;
  private synthesisChain: Promise<unknown> = Promise.resolve();
  private kittenProcess: ChildProcess | null = null;
  private kittenReadline: ReturnType<typeof createInterface> | null = null;
  private kittenPending: { resolve: (value: any) => void; timer: NodeJS.Timeout } | null = null;
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
    this.backend = process.env.TTS_BACKEND ?? "edge";
    const defaultScript = this.backend === "kitten-mini"
      ? "/app/assets/tts/kitten_tts_mini_daemon.py"
      : "/app/assets/tts/kitten_tts_daemon.py";
    this.kittenScript = process.env.KITTEN_TTS_SCRIPT ?? defaultScript;
    this.kittenVoice = process.env.TTS_VOICE ?? (this.backend === "kitten-mini" ? "Jasper" : "Bruno");
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
    const serviceUrl = process.env.TTS_SERVICE_URL;
    if (serviceUrl && process.env.TTS_STREAM === "true") {
      try {
        await this.speakRemoteStream(text, serviceUrl);
        return;
      } catch (error) {
        this.logger.warn({ err: error, text }, "tambola TTS stream failed; falling back to buffered synthesis");
      }
    }
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
    try { this.kittenProcess?.kill(); } catch { /* ignore */ }
    this.kittenProcess = null;
    this.kittenReadline?.close();
    this.kittenReadline = null;
    this.connection = null;
    this.player = null;
  }

  private async ensureKittenProcess(): Promise<ChildProcess> {
    if (this.kittenProcess && !this.kittenProcess.killed) return this.kittenProcess;
    const proc = spawn(process.env.TTS_PYTHON ?? "python3", [this.kittenScript], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const rl = createInterface({ input: proc.stdout! });
    this.kittenProcess = proc;
    this.kittenReadline = rl;
    rl.on("line", (line) => {
      if (!this.kittenPending) return;
      clearTimeout(this.kittenPending.timer);
      const pending = this.kittenPending;
      this.kittenPending = null;
      try {
        pending.resolve(JSON.parse(line));
      } catch {
        pending.resolve({ ok: false, error: line });
      }
    });
    proc.on("exit", () => {
      if (this.kittenPending) {
        clearTimeout(this.kittenPending.timer);
        this.kittenPending.resolve({ ok: false, error: "process exited" });
        this.kittenPending = null;
      }
      this.kittenProcess = null;
      this.kittenReadline?.close();
      this.kittenReadline = null;
    });
    const ready = await new Promise<any>((resolve) => {
      this.kittenPending = {
        resolve,
        timer: setTimeout(() => {
          if (this.kittenPending) {
            this.kittenPending = null;
            resolve({ ok: false, error: "startup timeout" });
          }
        }, 300_000),
      };
    });
    if (!ready?.ready) {
      proc.kill();
      this.kittenProcess = null;
      this.kittenReadline?.close();
      this.kittenReadline = null;
      throw new Error(ready?.error ?? "KittenTTS failed to start");
    }
    return proc;
  }

  private async synthesizeKitten(text: string, file: string): Promise<string | null> {
    if (this.disabled) return null;
    let proc: ChildProcess;
    try {
      proc = await this.ensureKittenProcess();
    } catch (error) {
      this.failures += 1;
      this.logger.warn({ err: error, text, failures: this.failures }, "tambola TTS synthesis failed");
      if (this.failures >= 3) this.disabled = true;
      return null;
    }
    try {
      const result = await new Promise<any>((resolve, reject) => {
        this.kittenPending = {
          resolve,
          timer: setTimeout(() => {
            if (this.kittenPending) {
              this.kittenPending = null;
              reject(new Error("KittenTTS synthesis timeout"));
            }
          }, 120_000),
        };
        proc.stdin?.write(JSON.stringify({ text, output: file, voice: this.kittenVoice }) + "\n");
      });
      if (!result?.ok) throw new Error(result?.error ?? "KittenTTS synthesis failed");
      if (!existsSync(file) || statSync(file).size === 0) throw new Error("kitten-tts produced an empty file");
      this.synthesized += 1;
      if (this.synthesized === 1) this.logger.info({ text }, "tambola TTS first clip ready");
      if (this.synthesized % 20 === 0) this.pruneCache();
      return file;
    } catch (error) {
      try { proc.kill(); } catch { /* ignore */ }
      this.kittenProcess = null;
      this.kittenReadline?.close();
      this.kittenReadline = null;
      this.failures += 1;
      this.logger.warn({ err: error, text, failures: this.failures }, "tambola TTS synthesis failed");
      if (this.failures >= 3) this.disabled = true;
      return null;
    }
  }

  private async speakRemoteStream(text: string, serviceUrl: string): Promise<void> {
    if (!this.player) throw new Error("audio player not ready");
    const response = await fetch(`${serviceUrl.replace(/\/$/, "")}/synthesize-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: this.kittenVoice || this.voice }),
    });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const stream = Readable.fromWeb(response.body as any);
    if (this.player.state.status !== AudioPlayerStatus.Idle) {
      this.player.stop(true);
    }
    this.player.play(createAudioResource(stream, { inputType: StreamType.Arbitrary }));
    this.logger.debug({ text }, "tambola TTS stream playback started");
  }

  private async synthesizeRemote(text: string, file: string, serviceUrl: string): Promise<string | null> {
    if (this.disabled) return null;
    try {
      const response = await fetch(`${serviceUrl.replace(/\/$/, "")}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: this.kittenVoice || this.voice }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length === 0) throw new Error("empty audio response");
      writeFileSync(file, data);
      this.synthesized += 1;
      if (this.synthesized === 1) this.logger.info({ text }, "tambola TTS first clip ready");
      if (this.synthesized % 20 === 0) this.pruneCache();
      return file;
    } catch (error) {
      this.failures += 1;
      this.logger.warn({ err: error, text, failures: this.failures }, "tambola TTS synthesis failed");
      if (this.failures >= 3) this.disabled = true;
      return null;
    }
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
    const extension = this.backend === "kitten" || this.backend === "kitten-mini" ? "wav" : "mp3";
    const file = join(this.cacheDir, `${key}.${extension}`);
    if (existsSync(file)) {
      const size = statSync(file).size;
      if (size > 0) return file;
      rmSync(file, { force: true });
    }

    const serviceUrl = process.env.TTS_SERVICE_URL;
    if (serviceUrl) {
      return this.synthesizeRemote(text, file, serviceUrl);
    }

    const temp = this.backend === "kitten" || this.backend === "kitten-mini"
      ? join(this.cacheDir, `${key}.${randomUUID()}.tmp.wav`)
      : join(this.cacheDir, `${key}.${randomUUID()}.tmp.mp3`);
    try {
      if (this.backend === "kitten") {
        await execFileAsync(
          process.env.TTS_PYTHON ?? "python3",
          [
            this.kittenScript,
            "--voice",
            this.kittenVoice,
            "--text",
            text,
            "--output",
            temp,
          ],
          { timeout: 120_000, maxBuffer: 1024 * 1024 },
        );
      } else {
        let lastError: unknown;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            await execFileAsync(
              process.env.TTS_PYTHON ?? "python3",
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
              { timeout: 30_000, maxBuffer: 1024 * 1024 },
            );
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
          }
        }
        if (lastError) throw lastError;
      }
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
        .filter((name) => name.endsWith(".mp3") || name.endsWith(".wav"))
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
