import { existsSync, createReadStream } from "node:fs";
import { join } from "node:path";
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
  type VoiceConnection,
} from "@discordjs/voice";
import { ChannelType, type Guild, type VoiceChannel } from "discord.js";
import type { Logger } from "../lib/logger.js";
import type { MusicService } from "./music.js";

const MIN_DELAY_MS = 2 * 60 * 60 * 1000;
const MAX_DELAY_MS = 6 * 60 * 60 * 1000;
const SOUNDS = ["faahhh.ogg", "pipe-drop.ogg"];

function soundPath(filename: string): string | null {
  for (const candidate of [
    join(process.cwd(), "assets", "sfx", filename),
    join(process.cwd(), "apps", "bot", "assets", "sfx", filename),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export class RandomVcService {
  private guild: Guild | null = null;
  private timer: NodeJS.Timeout | null = null;
  private connection: VoiceConnection | null = null;
  private player: AudioPlayer | null = null;

  constructor(
    private readonly music: MusicService | null,
    private readonly logger: Logger,
  ) {}

  start(guild: Guild): void {
    this.guild = guild;
    this.schedule();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.player?.stop(true);
    this.connection?.destroy();
    this.player = null;
    this.connection = null;
    this.guild = null;
  }

  private schedule(): void {
    if (this.timer || !this.guild) return;
    const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.attempt().catch((error) => this.logger.warn({ err: error }, "random VC moment failed"));
    }, delay);
    this.timer.unref?.();
  }

  private pickChannel(guild: Guild): VoiceChannel | null {
    const me = guild.members.me;
    if (!me) return null;
    const channels = guild.channels.cache.filter((channel): channel is VoiceChannel => {
      if (channel.type !== ChannelType.GuildVoice) return false;
      if (guild.afkChannelId && channel.id === guild.afkChannelId) return false;
      if (channel.userLimit > 0 && channel.members.size >= channel.userLimit) return false;
      if (![...channel.members.values()].some((member) => !member.user.bot)) return false;
      const permissions = channel.permissionsFor(me);
      return Boolean(permissions?.has(["Connect", "Speak"]));
    });
    return channels.random() ?? null;
  }

  private async attempt(): Promise<void> {
    const guild = this.guild;
    if (!guild) return;
    this.schedule();
    if (this.music?.isConnected(guild.id)) return;
    const channel = this.pickChannel(guild);
    if (!channel) return;

    const filename = SOUNDS[Math.floor(Math.random() * SOUNDS.length)]!;
    const path = soundPath(filename);
    if (!path) {
      this.logger.warn({ filename }, "random VC sound file missing");
      return;
    }

    try {
      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true,
      });
      this.connection = connection;
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

      const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
      this.player = player;
      connection.subscribe(player);
      const resource = createAudioResource(createReadStream(path), {
        inputType: StreamType.OggOpus,
        inlineVolume: true,
      });
      resource.volume?.setVolume(0.9);

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 5_000);
        timer.unref?.();
        const done = (): void => {
          clearTimeout(timer);
          resolve();
        };
        player.once(AudioPlayerStatus.Idle, done);
        player.once("error", done);
        player.play(resource);
      });

      this.logger.info({ channelId: channel.id, sound: filename }, "random VC moment");
    } catch (error) {
      this.logger.warn({ err: error, channelId: channel.id }, "random VC moment failed");
    } finally {
      this.player?.stop(true);
      this.connection?.destroy();
      this.player = null;
      this.connection = null;
    }
  }
}
