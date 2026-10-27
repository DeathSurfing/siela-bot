import { styleMessage } from "./ui.js";
import { eq } from "drizzle-orm";
import { memberActivity, type Database, type MemberActivityRow } from "@siela/db";
import type { Client, Guild } from "discord.js";
import type { SettingsService } from "./settings.js";
import type { Logger } from "../lib/logger.js";

const XP_PER_MESSAGE = 10;
const XP_PER_COMMAND = 5;
const XP_PER_REACTION = 2;
const VOICE_XP_PER_MINUTE = 1;

export function xpForLevel(level: number): number {
  return level * level * 100;
}

export function levelFromXp(xp: number): number {
  let level = 0;
  while (xp >= xpForLevel(level + 1)) level += 1;
  return level;
}

export class LevelingService {
  private readonly xp = new Map<string, number>();
  private readonly level = new Map<string, number>();

  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly client: Client,
    private readonly logger: Logger,
  ) {}

  private key(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
  }

  async reconcile(guild: Guild): Promise<void> {
    const rows = await this.db
      .select()
      .from(memberActivity)
      .where(eq(memberActivity.guildId, guild.id));
    for (const row of rows) {
      this.xp.set(this.key(guild.id, row.userId), row.xp ?? 0);
      this.level.set(this.key(guild.id, row.userId), row.level ?? 0);
    }
  }

  async award(guildId: string, userId: string, amount: number, reason?: string): Promise<void> {
    if (amount <= 0) return;
    const k = this.key(guildId, userId);
    const currentXp = (this.xp.get(k) ?? 0) + amount;
    this.xp.set(k, currentXp);
    const newLevel = levelFromXp(currentXp);
    const oldLevel = this.level.get(k) ?? 0;
    await this.persist(guildId, userId, currentXp, newLevel).catch((error) =>
      this.logger.warn({ err: error, guildId, userId }, "leveling persist failed"),
    );
    if (newLevel > oldLevel) {
      this.level.set(k, newLevel);
      await this.announce(guildId, userId, newLevel).catch((error) =>
        this.logger.warn({ err: error, guildId, userId }, "leveling announce failed"),
      );
    }
  }

  async awardMessage(guildId: string, userId: string): Promise<void> {
    await this.award(guildId, userId, XP_PER_MESSAGE, "message");
  }

  async awardCommand(guildId: string, userId: string): Promise<void> {
    await this.award(guildId, userId, XP_PER_COMMAND, "command");
  }

  async awardReaction(guildId: string, userId: string): Promise<void> {
    await this.award(guildId, userId, XP_PER_REACTION, "reaction");
  }

  async awardVoiceSeconds(guildId: string, userId: string, seconds: number): Promise<void> {
    const minutes = Math.floor(seconds / 60);
    if (minutes <= 0) return;
    await this.award(guildId, userId, minutes * VOICE_XP_PER_MINUTE, "voice");
  }

  getXp(guildId: string, userId: string): number {
    return this.xp.get(this.key(guildId, userId)) ?? 0;
  }

  getLevel(guildId: string, userId: string): number {
    return this.level.get(this.key(guildId, userId)) ?? levelFromXp(this.getXp(guildId, userId));
  }

  private async persist(guildId: string, userId: string, xp: number, level: number): Promise<void> {
    await this.db
      .insert(memberActivity)
      .values({
        guildId,
        userId,
        xp,
        level,
        lastActiveAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [memberActivity.guildId, memberActivity.userId],
        set: { xp, level, updatedAt: new Date() },
      });
  }

  private async announce(guildId: string, userId: string, level: number): Promise<void> {
    const channelId = await this.settings.getLevelingChannel(guildId);
    if (!channelId) return;
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return;
    const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel?.isTextBased()) return;
    await channel.send(styleMessage({
      content: `🎉 <@${userId}> reached **Level ${level}**!`,
      allowedMentions: { parse: ["users"] },
    }));
  }
}

export { XP_PER_MESSAGE, XP_PER_COMMAND, XP_PER_REACTION, VOICE_XP_PER_MINUTE };