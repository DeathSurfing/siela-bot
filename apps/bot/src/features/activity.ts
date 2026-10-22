import { and, desc, eq, lt, sql } from "drizzle-orm";
import {
  friendshipLevels,
  memberActivity,
  type Database,
  type FriendshipLevelRow,
  type MemberActivityRow,
} from "@siela/db";
import { ChannelType } from "discord.js";
import type { Client, Guild, GuildMember, VoiceState } from "discord.js";
import type { TempVcService } from "./tempvc.js";
import type { MusicService } from "./music.js";
import { FriendshipService } from "./friendship.js";
import type { Logger } from "../lib/logger.js";

const FLUSH_INTERVAL_MS = 5 * 60 * 1000;
const VOICE_XP_INTERVAL_MS = 10 * 60 * 1000;
const RETENTION_DAYS = 90;

interface VoiceSession {
  channelId: string;
  joinedAt: number;
  lastFlushedAt: number;
}

interface PairSession {
  channelId: string;
  startedAt: number;
  lastAwardedAt: number;
  lastTimeFlushedAt: number;
}

interface ActivityDelta {
  messages: number;
  commands: number;
  reactions: number;
  voiceSeconds: number;
  lastActiveAt: number;
}

export class ActivityService {
  private readonly voiceSessions = new Map<string, Map<string, VoiceSession>>();
  private readonly pairSessions = new Map<string, PairSession>();
  private readonly activity = new Map<string, Map<string, ActivityDelta>>();
  private readonly dirtyActivity = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private pairTimer: NodeJS.Timeout | null = null;
  private pairTicking = false;
  private lastPurgeDate: string | null = null;

  constructor(
    private readonly db: Database,
    private readonly friendship: FriendshipService,
    private readonly tempVc: TempVcService,
    private readonly music: MusicService,
    private readonly logger: Logger,
  ) {}

  private guildSessions(guildId: string): Map<string, VoiceSession> {
    let sessions = this.voiceSessions.get(guildId);
    if (!sessions) {
      sessions = new Map();
      this.voiceSessions.set(guildId, sessions);
    }
    return sessions;
  }

  private activityMap(guildId: string): Map<string, ActivityDelta> {
    let stats = this.activity.get(guildId);
    if (!stats) {
      stats = new Map();
      this.activity.set(guildId, stats);
    }
    return stats;
  }

  private delta(guildId: string, userId: string): ActivityDelta {
    const stats = this.activityMap(guildId);
    let current = stats.get(userId);
    if (!current) {
      current = { messages: 0, commands: 0, reactions: 0, voiceSeconds: 0, lastActiveAt: Date.now() };
      stats.set(userId, current);
    }
    return current;
  }

  private markDirty(guildId: string, userId: string): void {
    this.dirtyActivity.add(`${guildId}:${userId}`);
  }

  private pairKey(guildId: string, a: string, b: string): string {
    const [first, second] = a < b ? [a, b] : [b, a];
    return `${guildId}:${first}:${second}`;
  }

  private isFriendshipChannel(guildId: string, channelId: string): boolean {
    if (this.music.channelId(guildId) === channelId) return true;
    return false;
  }

  private async trackedFriendshipChannel(guildId: string, channelId: string): Promise<boolean> {
    if (this.isFriendshipChannel(guildId, channelId)) return true;
    const row = await this.tempVc.getRow(channelId);
    return row?.status === "active";
  }

  private channelMembers(guild: Guild, channelId: string): string[] {
    const channel = guild.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) return [];
    return [...channel.members.keys()].filter((id) => {
      const member = channel.members.get(id);
      return !member?.user.bot;
    });
  }

  async reconcile(guild: Guild): Promise<void> {
    const guildSessions = this.guildSessions(guild.id);
    for (const channel of guild.channels.cache.values()) {
      if (channel.type !== ChannelType.GuildVoice) continue;
      for (const member of channel.members.values()) {
        if (member.user.bot) continue;
        guildSessions.set(member.id, { channelId: channel.id, joinedAt: Date.now(), lastFlushedAt: Date.now() });
      }
      if (await this.trackedFriendshipChannel(guild.id, channel.id)) {
        const members = [...channel.members.keys()].filter((id) => !channel.members.get(id)?.user.bot);
        for (let i = 0; i < members.length; i += 1) {
          for (let j = i + 1; j < members.length; j += 1) {
            const key = this.pairKey(guild.id, members[i]!, members[j]!);
            if (!this.pairSessions.has(key)) {
              this.pairSessions.set(key, {
                channelId: channel.id,
                startedAt: Date.now(),
                lastAwardedAt: Date.now(),
                lastTimeFlushedAt: Date.now(),
              });
            }
          }
        }
      }
    }
  }

  async handleVoiceState(oldState: VoiceState, newState: VoiceState): Promise<void> {
    const guild = newState.guild ?? oldState.guild;
    if (!guild) return;
    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) return;
    const userId = member.id;
    const now = Date.now();
    const oldChannel = oldState.channelId;
    const newChannel = newState.channelId;

    const sessions = this.guildSessions(guild.id);

    if (oldChannel && oldChannel !== newChannel) {
      const session = sessions.get(userId);
      if (session) {
        this.addVoiceTime(guild.id, userId, Math.floor((now - session.lastFlushedAt) / 1000));
        sessions.delete(userId);
      }

      for (const [key, pair] of [...this.pairSessions.entries()]) {
        if (!key.startsWith(`${guild.id}:`)) continue;
        if (pair.channelId !== oldChannel) continue;
        const [, a, b] = key.split(":") as [string, string, string];
        if (a !== userId && b !== userId) continue;
        await this.closePair(guild.id, a!, b!, pair, now);
        this.pairSessions.delete(key);
      }
    }

    if (newChannel) {
      sessions.set(userId, { channelId: newChannel, joinedAt: now, lastFlushedAt: now });
      if (await this.trackedFriendshipChannel(guild.id, newChannel)) {
        const members = this.channelMembers(guild, newChannel);
        for (const other of members) {
          if (other === userId) continue;
          const [a, b] = this.pairKey(guild.id, userId, other).split(":").slice(1);
          const key = `${guild.id}:${a}:${b}`;
          const existing = this.pairSessions.get(key);
          if (existing && existing.channelId !== newChannel) {
            await this.closePair(guild.id, a!, b!, existing, now);
            this.pairSessions.delete(key);
          }
          if (!this.pairSessions.has(key)) {
            this.pairSessions.set(key, {
              channelId: newChannel,
              startedAt: now,
              lastAwardedAt: now,
              lastTimeFlushedAt: now,
            });
          }
        }
      }
    }
  }

  private accruePairState(pair: PairSession, now: number): { xp: number; seconds: number } {
    const seconds = Math.max(0, Math.floor((now - pair.lastTimeFlushedAt) / 1000));
    if (seconds > 0) pair.lastTimeFlushedAt += seconds * 1000;
    const xp = Math.floor((now - pair.lastAwardedAt) / VOICE_XP_INTERVAL_MS);
    if (xp > 0) pair.lastAwardedAt += xp * VOICE_XP_INTERVAL_MS;
    return { xp, seconds };
  }

  private async closePair(guildId: string, a: string, b: string, pair: PairSession, now: number): Promise<void> {
    const { xp, seconds } = this.accruePairState(pair, now);
    if (xp > 0 || seconds > 0) {
      await this.friendship.addBatch([{ guildId, firstUserId: a, secondUserId: b, xp, seconds }]);
    }
  }

  private async accruePairs(): Promise<void> {
    if (this.pairTicking) return;
    this.pairTicking = true;
    try {
      const now = Date.now();
      const deltas: Array<{ guildId: string; firstUserId: string; secondUserId: string; xp: number; seconds: number }> = [];
      for (const [key, pair] of this.pairSessions) {
        const [guildId, a, b] = key.split(":") as [string, string, string];
        if (!guildId || !a || !b) continue;
        const accrued = this.accruePairState(pair, now);
        if (accrued.xp > 0 || accrued.seconds > 0) {
          deltas.push({ guildId, firstUserId: a, secondUserId: b, ...accrued });
        }
      }
      if (deltas.length) await this.friendship.addBatch(deltas);
    } finally {
      this.pairTicking = false;
    }
  }

  private addVoiceTime(guildId: string, userId: string, seconds: number): void {
    if (seconds <= 0) return;
    const current = this.delta(guildId, userId);
    current.voiceSeconds += seconds;
    current.lastActiveAt = Date.now();
    this.markDirty(guildId, userId);
  }

  recordMessage(guildId: string, userId: string): void {
    const current = this.delta(guildId, userId);
    current.messages += 1;
    current.lastActiveAt = Date.now();
    this.markDirty(guildId, userId);
  }

  recordCommand(guildId: string, userId: string): void {
    const current = this.delta(guildId, userId);
    current.commands += 1;
    current.lastActiveAt = Date.now();
    this.markDirty(guildId, userId);
  }

  recordReaction(guildId: string, userId: string): void {
    const current = this.delta(guildId, userId);
    current.reactions += 1;
    current.lastActiveAt = Date.now();
    this.markDirty(guildId, userId);
  }

  async get(guildId: string, userId: string): Promise<MemberActivityRow | null> {
    await this.flush();
    const [row] = await this.db
      .select()
      .from(memberActivity)
      .where(and(eq(memberActivity.guildId, guildId), eq(memberActivity.userId, userId)))
      .limit(1);
    if (!row) return null;
    const pending = this.activity.get(guildId)?.get(userId);
    if (!pending) return row;
    return {
      ...row,
      messages: row.messages + pending.messages,
      commands: row.commands + pending.commands,
      reactions: row.reactions + pending.reactions,
      voiceSeconds: row.voiceSeconds + pending.voiceSeconds,
      lastActiveAt: new Date(Math.max(row.lastActiveAt.getTime(), pending.lastActiveAt)),
    };
  }

  async leaderboard(guildId: string, metric: "messages" | "commands" | "reactions" | "voice", limit = 10): Promise<MemberActivityRow[]> {
    await this.flush();
    const order =
      metric === "messages"
        ? desc(memberActivity.messages)
        : metric === "commands"
          ? desc(memberActivity.commands)
          : metric === "reactions"
            ? desc(memberActivity.reactions)
            : desc(memberActivity.voiceSeconds);
    return this.db
      .select()
      .from(memberActivity)
      .where(eq(memberActivity.guildId, guildId))
      .orderBy(order)
      .limit(limit);
  }

  async flush(): Promise<void> {
    const now = Date.now();
    for (const guildId of this.voiceSessions.keys()) {
      const sessions = this.voiceSessions.get(guildId)!;
      for (const [userId, session] of sessions) {
        const elapsed = Math.max(0, Math.floor((now - session.lastFlushedAt) / 1000));
        if (elapsed > 0) this.addVoiceTime(guildId, userId, elapsed);
        session.lastFlushedAt = now;
      }
    }

    for (const dirty of [...this.dirtyActivity]) {
      const [guildId, userId] = dirty.split(":") as [string, string];
      const delta = this.activity.get(guildId)?.get(userId);
      if (!delta) {
        this.dirtyActivity.delete(dirty);
        continue;
      }
      try {
        await this.db
          .insert(memberActivity)
          .values({
            guildId: guildId!,
            userId: userId!,
            messages: delta.messages,
            commands: delta.commands,
            reactions: delta.reactions,
            voiceSeconds: delta.voiceSeconds,
            lastActiveAt: new Date(delta.lastActiveAt),
          })
          .onConflictDoUpdate({
            target: [memberActivity.guildId, memberActivity.userId],
            set: {
              messages: sql`${memberActivity.messages} + ${delta.messages}`,
              commands: sql`${memberActivity.commands} + ${delta.commands}`,
              reactions: sql`${memberActivity.reactions} + ${delta.reactions}`,
              voiceSeconds: sql`${memberActivity.voiceSeconds} + ${delta.voiceSeconds}`,
              lastActiveAt: new Date(delta.lastActiveAt),
              updatedAt: new Date(),
            },
          });
        delta.messages = 0;
        delta.commands = 0;
        delta.reactions = 0;
        delta.voiceSeconds = 0;
        this.dirtyActivity.delete(dirty);
      } catch (error) {
        this.logger.warn({ err: error, guildId, userId }, "failed to flush activity");
      }
    }
  }

  async purgeOld(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    try {
      await this.db.delete(memberActivity).where(lt(memberActivity.lastActiveAt, cutoff));
    } catch (error) {
      this.logger.warn({ err: error }, "failed to purge old activity");
    }
  }

  start(): void {
    this.timer = setInterval(() => {
      void this.tick().catch((error) => this.logger.warn({ err: error }, "activity tick failed"));
    }, FLUSH_INTERVAL_MS);
    this.timer.unref?.();
    this.pairTimer = setInterval(() => {
      void this.accruePairs().catch((error) => this.logger.warn({ err: error }, "friendship pair tick failed"));
    }, 1_000);
    this.pairTimer.unref?.();
    setTimeout(() => {
      void this.tick().catch((error) => this.logger.warn({ err: error }, "activity tick failed"));
    }, 10_000).unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.pairTimer) {
      clearInterval(this.pairTimer);
      this.pairTimer = null;
    }
    await this.accruePairs().catch(() => undefined);
    await this.flush().catch(() => undefined);
  }

  private async tick(): Promise<void> {
    await this.flush();
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastPurgeDate !== today) {
      this.lastPurgeDate = today;
      await this.purgeOld();
    }
  }
}
