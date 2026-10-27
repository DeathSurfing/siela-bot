import { ChannelType } from "discord.js";
import type { GuildBasedChannel, GuildMember, Message } from "discord.js";
import type { BotConfig } from "@siela/config";
import { UserError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import type { MusicService } from "./music.js";
import { FleetClient } from "./fleetClient.js";
import { unloadTtsService, warmupTtsService } from "./ttsService.js";
import { TambolaVoice } from "./tambola/voice.js";
import {
  buildAttachmentUtterance,
  buildLinkUtterance,
  buildTtsUtterance,
  formatTtsBody,
  sanitizeSpeakerName,
  sanitizeTtsText,
} from "./tts-format.js";

const MAX_TTS_CHARS = 200;
const MAX_MENTION_LOOKUPS = 10;

/** Drop a silent TTS session so the bot doesn't idle in voice forever. */
export const TTS_IDLE_MS = 30_000;

interface TtsSession {
  channelId: string;
  voice: TambolaVoice | null;
  enabled: boolean;
  lastSpeakerId: string | null;
  /** Node holding the voice connection. Sticky until disabled. */
  nodeId: string;
}

export class TtsService {
  private readonly sessions = new Map<string, TtsSession>();
  private readonly idleTimers = new Map<string, NodeJS.Timeout>();
  /** Other features that synthesize speech, such as an active Tambola game. */
  private consumerChecker: ((guildId: string) => boolean) | null = null;

  constructor(
    private readonly music: MusicService | null,
    private readonly config: BotConfig,
    readonly logger: Logger,
  ) {}

  /** Register another feature that may be synthesizing speech right now. */
  setConsumerChecker(checker: ((guildId: string) => boolean) | null): void {
    this.consumerChecker = checker;
  }

  /** True while any standalone TTS session is enabled. */
  hasActiveSession(): boolean {
    return [...this.sessions.values()].some((session) => session.enabled);
  }

  /**
   * Drop the synthesis model only when nothing is using it. A live Tambola
   * game or an enabled TTS session keeps it resident.
   */
  async maybeUnload(guildId: string): Promise<void> {
    if (this.hasActiveSession()) return;
    if (this.consumerChecker?.(guildId)) return;
    await unloadTtsService(this.logger);
  }

  private fleet(): FleetClient {
    return new FleetClient(this.config.ROUTER_URL ?? null, this.config.MCP_TOKEN, this.logger);
  }

  /** Reset the 30s no-text idle timer. Any spoken text keeps the session. */
  private pokeActivity(guildId: string): void {
    const existing = this.idleTimers.get(guildId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.idleTimers.delete(guildId);
      void this.disable(guildId).catch(() => undefined);
    }, TTS_IDLE_MS);
    timer.unref?.();
    this.idleTimers.set(guildId, timer);
  }

  private clearIdleTimer(guildId: string): void {
    const timer = this.idleTimers.get(guildId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(guildId);
    }
  }

  private cleanupIfDisconnected(guildId: string): void {
    const session = this.sessions.get(guildId);
    if (!session) return;
    // Remote sessions live on the worker; only the local voice can drop.
    if (!session.voice) return;
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

  /** Node holding this guild's TTS voice, or null when TTS is off. */
  sessionNode(guildId: string): string | null {
    return this.sessions.get(guildId)?.nodeId ?? null;
  }

  /** Voice channel this guild's TTS is speaking into, or null when off. */
  sessionChannel(guildId: string): string | null {
    return this.sessions.get(guildId)?.channelId ?? null;
  }

  /** True when this process holds the TTS voice connection. */
  isLocal(guildId: string): boolean {
    const session = this.sessions.get(guildId);
    return Boolean(session?.enabled && session.voice && session.nodeId === this.config.NODE_ID);
  }

  /** Record a session owned by another fleet node (commander-side only). */
  recordRemoteSession(guildId: string, nodeId: string, channelId: string): void {
    this.sessions.set(guildId, { channelId, voice: null, enabled: true, lastSpeakerId: null, nodeId });
    this.pokeActivity(guildId);
  }

  forgetSession(guildId: string): void {
    this.clearIdleTimer(guildId);
    this.sessions.delete(guildId);
    this.music?.unlockVoice(guildId);
  }

  async enable(guildId: string, member: GuildMember, channelId: string | null): Promise<void> {
    const voiceChannelId = channelId ?? member.voice.channelId;
    if (!voiceChannelId) throw new UserError("Join a voice channel first.");
    const guild = member.guild;
    const channel = guild.channels.cache.get(voiceChannelId) ?? await guild.channels.fetch(voiceChannelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildVoice) throw new UserError("Choose a voice channel.");

    await this.disable(guildId, { keepModel: true });
    const voice = new TambolaVoice(this.logger);
    const joined = await voice.join(channel as any);
    if (!joined) throw new UserError("Could not join that voice channel. Check Connect and Speak permissions.");

    this.logger.info({ guildId, channelId: channel.id }, "TTS enabled");
    // Load the model now so the first utterance does not wait on it.
    void warmupTtsService(this.logger);
    this.sessions.set(guildId, { channelId: channel.id, voice, enabled: true, lastSpeakerId: null, nodeId: this.config.NODE_ID });
    this.pokeActivity(guildId);
    if (this.music) {
      try { await this.music.disconnect(guildId); } catch { /* ignore */ }
      this.music.lockVoice(guildId);
    }
  }

  async disable(guildId: string, options: { keepModel?: boolean } = {}): Promise<void> {
    this.clearIdleTimer(guildId);
    const session = this.sessions.get(guildId);
    if (session && !session.voice && session.nodeId !== this.config.NODE_ID) {
      // Remote session: tell the owning worker to stand down, then forget it.
      try {
        await this.fleet().ttsDisable(session.nodeId);
      } catch (error) {
        this.logger.warn({ err: error, guildId, nodeId: session.nodeId }, "remote TTS disable failed");
      }
      this.sessions.delete(guildId);
      this.music?.unlockVoice(guildId);
      return;
    }
    if (session?.voice) {
      session.voice.leave();
      this.sessions.delete(guildId);
    }
    this.music?.unlockVoice(guildId);
    // Release the model only when no other session is speaking.
    if (!options.keepModel) await this.maybeUnload(guildId);
  }

  async speak(guildId: string, text: string, opts: { speakerId?: string; speakerName?: string } = {}): Promise<void> {
    const session = this.sessions.get(guildId);
    if (!session?.enabled) return;
    const { text: body } = sanitizeTtsText(text);
    if (!body) return;
    const trimmed = body.slice(0, MAX_TTS_CHARS).trim();
    if (!trimmed) return;
    const isNewSpeaker = opts.speakerId ? session.lastSpeakerId !== opts.speakerId : true;
    const utterance = buildTtsUtterance(trimmed, opts.speakerName ?? null, isNewSpeaker);
    if (!utterance) return;
    this.pokeActivity(guildId);
    if (!session.voice) {
      await this.forwardUtterance(guildId, session.nodeId, utterance, opts.speakerId);
      if (opts.speakerId) session.lastSpeakerId = opts.speakerId;
      return;
    }
    this.logger.info({ guildId, channelId: session.channelId, text: utterance }, "TTS speaking");
    await session.voice.speak(utterance);
    if (opts.speakerId) {
      session.lastSpeakerId = opts.speakerId;
    }
  }

  /** Speak a prebuilt utterance on this process's voice connection (worker path). */
  async speakUtterance(guildId: string, utterance: string, speakerId?: string): Promise<void> {
    const session = this.sessions.get(guildId);
    if (!session?.enabled || !session.voice) return;
    if (!utterance) return;
    this.pokeActivity(guildId);
    this.logger.info({ guildId, channelId: session.channelId, text: utterance }, "TTS speaking");
    await session.voice.speak(utterance);
    if (speakerId) session.lastSpeakerId = speakerId;
  }

  private async forwardUtterance(guildId: string, nodeId: string, utterance: string, speakerId?: string): Promise<void> {
    try {
      await this.fleet().ttsSpeak(nodeId, utterance, speakerId);
    } catch (error) {
      this.logger.warn({ err: error, guildId, nodeId }, "remote TTS speak failed");
    }
  }

  /**
   * Speak a Discord message: resolves user/channel/role mentions to names,
   * turns links into "a link", and prefixes "{User} said, ..." only when the
   * speaker changed since the previous spoken message.
   */
  async speakMessage(message: Message): Promise<void> {
    if (!message.inGuild() || !message.guild) return;
    const guildId = message.guild.id;
    const session = this.sessions.get(guildId);
    if (!session?.enabled) return;
    if (message.channel.id !== session.channelId) return;
    if (message.author.bot || message.webhookId) return;
    const raw = message.content ?? "";
    if (raw.startsWith("/") || raw.startsWith("!")) return;

    const speakerId = message.author.id;
    const rawSpeaker =
      message.member?.displayName ?? message.author.displayName ?? message.author.username;
    const speakerName = sanitizeSpeakerName(rawSpeaker);
    const isNewSpeaker = session.lastSpeakerId !== speakerId;

    const lookups = await this.resolveMentionNames(message);
    const { text: body, linkOnly } = formatTtsBody(raw, lookups);

    let utterance: string;
    if (body) {
      const trimmed = body.slice(0, MAX_TTS_CHARS).trim();
      if (!trimmed) return;
      utterance = buildTtsUtterance(trimmed, speakerName, isNewSpeaker);
    } else if (linkOnly) {
      utterance = buildLinkUtterance(speakerName, isNewSpeaker);
    } else {
      const attachmentKind = this.attachmentKind(message);
      if (!attachmentKind) return;
      utterance = buildAttachmentUtterance(speakerName, isNewSpeaker, attachmentKind);
    }

    if (!utterance) return;
    this.pokeActivity(guildId);
    if (!session.voice) {
      await this.forwardUtterance(guildId, session.nodeId, utterance, speakerId);
      session.lastSpeakerId = speakerId;
      return;
    }
    this.logger.info({ guildId, channelId: session.channelId, text: utterance }, "TTS speaking");
    await session.voice.speak(utterance);
    session.lastSpeakerId = speakerId;
  }

  private attachmentKind(message: Message): string | null {
    if (message.stickers.size > 0) return "a sticker";
    if (message.attachments.size === 0) return null;
    const first = message.attachments.first();
    const contentType = first?.contentType ?? "";
    if (contentType.startsWith("image/")) return "an image";
    if (contentType.startsWith("video/")) return "a video";
    if (contentType.startsWith("audio/")) return "an audio clip";
    return "a file";
  }

  private async resolveMentionNames(message: Message): Promise<{
    users: Map<string, string>;
    channels: Map<string, string>;
    roles: Map<string, string>;
  }> {
    const users = new Map<string, string>();
    const channels = new Map<string, string>();
    const roles = new Map<string, string>();
    if (!message.guild) return { users, channels, roles };

    const content = message.content ?? "";
    const userIds = new Set<string>();
    for (const match of content.matchAll(/<@!?(\d+)>/g)) {
      const id = match[1];
      if (id) userIds.add(id);
    }
    const channelIds = new Set<string>();
    for (const match of content.matchAll(/<#(\d+)>/g)) {
      const id = match[1];
      if (id) channelIds.add(id);
    }
    const roleIds = new Set<string>();
    for (const match of content.matchAll(/<@&(\d+)>/g)) {
      const id = match[1];
      if (id) roleIds.add(id);
    }

    for (const id of [...userIds].slice(0, MAX_MENTION_LOOKUPS)) {
      const mentionedMember = message.mentions.members?.get(id);
      const mentionedUser = message.mentions.users?.get(id);
      const cached = message.guild.members.cache.get(id);
      const name =
        mentionedMember?.displayName ??
        mentionedUser?.displayName ??
        mentionedUser?.username ??
        cached?.displayName;
      if (name) {
        users.set(id, name);
        continue;
      }
      const fetched = await message.guild.members.fetch(id).catch(() => null);
      if (fetched?.displayName) users.set(id, fetched.displayName);
    }

    for (const id of [...channelIds].slice(0, MAX_MENTION_LOOKUPS)) {
      const cached = message.guild.channels.cache.get(id);
      if (cached?.name) {
        channels.set(id, cached.name);
        continue;
      }
      const fetched = await message.guild.channels.fetch(id).catch(() => null);
      if (fetched && "name" in fetched && typeof fetched.name === "string") {
        channels.set(id, fetched.name);
      }
    }

    for (const id of [...roleIds].slice(0, MAX_MENTION_LOOKUPS)) {
      const cached = message.guild.roles.cache.get(id);
      const name = cached?.name ?? (await message.guild.roles.fetch(id).catch(() => null))?.name;
      if (name) roles.set(id, name);
    }

    return { users, channels, roles };
  }

  stop(): void {
    for (const guildId of this.sessions.keys()) void this.disable(guildId);
    for (const guildId of [...this.idleTimers.keys()]) this.clearIdleTimer(guildId);
  }
}
