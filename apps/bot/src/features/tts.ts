import { ChannelType } from "discord.js";
import type { GuildBasedChannel, GuildMember } from "discord.js";
import type { BotConfig } from "@siela/config";
import { UserError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import type { MusicService } from "./music.js";
import { TambolaVoice } from "./tambola/voice.js";

interface TtsSession {
  channelId: string;
  voice: TambolaVoice;
  enabled: boolean;
}

export class TtsService {
  private readonly sessions = new Map<string, TtsSession>();

  constructor(
    private readonly music: MusicService | null,
    private readonly config: BotConfig,
    private readonly logger: Logger,
  ) {}

  private cleanupIfDisconnected(guildId: string): void {
    const session = this.sessions.get(guildId);
    if (!session) return;
    if (!session.voice.connected) {
      session.voice.leave();
      this.sessions.delete(guildId);
      this.music?.unlockVoice(guildId);
    }
  }

  isEnabled(guildId: string): boolean {
    this.cleanupIfDisconnected(guildId);
    return this.sessions.get(guildId)?.enabled ?? false;
  }

  isEnabledChannel(guildId: string, channelId: string): boolean {
    this.cleanupIfDisconnected(guildId);
    const session = this.sessions.get(guildId);
    return Boolean(session?.enabled && session.channelId === channelId);
  }

  async enable(guildId: string, member: GuildMember, channelId: string | null): Promise<void> {
    const voiceChannelId = channelId ?? member.voice.channelId;
    if (!voiceChannelId) throw new UserError("Join a voice channel first.");
    const guild = member.guild;
    const channel = guild.channels.cache.get(voiceChannelId) ?? await guild.channels.fetch(voiceChannelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildVoice) throw new UserError("Choose a voice channel.");

    await this.disable(guildId);
    const voice = new TambolaVoice(this.logger);
    const joined = await voice.join(channel as any);
    if (!joined) throw new UserError("Could not join that voice channel. Check Connect and Speak permissions.");

    this.sessions.set(guildId, { channelId: channel.id, voice, enabled: true });
    if (this.music) {
      try { await this.music.disconnect(guildId); } catch { /* ignore */ }
      this.music.lockVoice(guildId);
    }
  }

  async disable(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId);
    if (session) {
      session.voice.leave();
      this.sessions.delete(guildId);
    }
    this.music?.unlockVoice(guildId);
  }

  async speak(guildId: string, text: string): Promise<void> {
    const session = this.sessions.get(guildId);
    if (!session?.enabled) return;
    const clean = text.trim().slice(0, 200);
    if (!clean) return;
    await session.voice.speak(clean);
  }

  stop(): void {
    for (const guildId of this.sessions.keys()) void this.disable(guildId);
  }
}
