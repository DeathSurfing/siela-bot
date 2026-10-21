import { and, desc, eq, sql } from "drizzle-orm";
import { confessions, guildSettings, type Database, type ConfessionRow } from "@siela/db";
import { EmbedBuilder, type Client, type Guild, type TextChannel } from "discord.js";
import { ChannelType } from "discord.js";
import { COLORS } from "@siela/shared";
import type { SettingsService } from "./settings.js";
import type { Logger } from "../lib/logger.js";
import { UserError } from "../lib/errors.js";

export class ConfessionService {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly client: Client,
    private readonly logger: Logger,
  ) {}

  async getChannel(guildId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ channelId: guildSettings.confessionChannelId })
      .from(guildSettings)
      .where(eq(guildSettings.guildId, guildId))
      .limit(1);
    return row?.channelId ?? null;
  }

  async setChannel(guildId: string, channelId: string, actorId: string): Promise<void> {
    await this.settings.ensure(guildId);
    await this.db
      .update(guildSettings)
      .set({ confessionChannelId: channelId, updatedAt: new Date(), updatedBy: actorId })
      .where(eq(guildSettings.guildId, guildId));
  }

  async clearChannel(guildId: string, actorId: string): Promise<void> {
    await this.settings.ensure(guildId);
    await this.db
      .update(guildSettings)
      .set({ confessionChannelId: null, updatedAt: new Date(), updatedBy: actorId })
      .where(eq(guildSettings.guildId, guildId));
  }

  async post(guildId: string, authorId: string, content: string): Promise<number> {
    const trimmed = content.trim();
    if (!trimmed) throw new UserError("A confession cannot be empty.");
    if (trimmed.length > 2_000) throw new UserError("Confessions must be 2,000 characters or fewer.");

    const channelId = await this.getChannel(guildId);
    if (!channelId) throw new UserError("No confession wall is configured. Ask an admin to set one.");

    const recentCutoff = new Date(Date.now() - 15 * 60 * 1000);
    const dayCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await this.db
      .select({ id: confessions.id, createdAt: confessions.createdAt })
      .from(confessions)
      .where(and(eq(confessions.guildId, guildId), eq(confessions.authorId, authorId), sql`${confessions.createdAt} >= ${recentCutoff}`));
    if (recent.length > 0) {
      const next = new Date(recent[0]!.createdAt.getTime() + 15 * 60 * 1000);
      const wait = Math.max(1, Math.ceil((next.getTime() - Date.now()) / 1000));
      throw new UserError(`You can confess again in ${Math.ceil(wait / 60)} minute(s).`);
    }
    const todayCount = await this.db
      .select({ id: confessions.id })
      .from(confessions)
      .where(and(eq(confessions.guildId, guildId), eq(confessions.authorId, authorId), sql`${confessions.createdAt} >= ${dayCutoff}`));
    if (todayCount.length >= 10) {
      throw new UserError("You have reached the daily confession limit.");
    }

    await this.settings.ensure(guildId);
    const [counter] = await this.db
      .update(guildSettings)
      .set({ confessionCounter: sql`coalesce(${guildSettings.confessionCounter}, 0) + 1`, updatedAt: new Date() })
      .where(eq(guildSettings.guildId, guildId))
      .returning({ number: guildSettings.confessionCounter });
    const number = counter?.number ?? 1;

    const [row] = await this.db
      .insert(confessions)
      .values({ guildId, channelId, authorId, number, content: trimmed })
      .returning();
    if (!row) throw new UserError("Failed to save the confession.");

    const guild = await this.client.guilds.fetch(guildId).catch(() => null);
    const channel = guild ? await guild.channels.fetch(channelId).catch(() => null) : null;
    if (!channel || !channel.isTextBased()) {
      await this.db.delete(confessions).where(eq(confessions.id, row.id));
      throw new UserError("The confession channel is no longer available.");
    }

    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle(`Confession #${number}`)
      .setDescription(trimmed)
      .setFooter({ text: "Anonymous confession" })
      .setTimestamp();

    try {
      const message = await (channel as TextChannel).send({ embeds: [embed], allowedMentions: { parse: [] } });
      await this.db.update(confessions).set({ messageId: message.id }).where(eq(confessions.id, row.id));
    } catch (error) {
      await this.db.delete(confessions).where(eq(confessions.id, row.id));
      this.logger.warn({ err: error, guildId, channelId }, "failed to post confession");
      throw new UserError("The confession could not be posted.");
    }

    return number;
  }

  async delete(guildId: string, number: number, actorId: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(confessions)
      .where(and(eq(confessions.guildId, guildId), eq(confessions.number, number)))
      .limit(1);
    if (!row || row.deletedAt) throw new UserError("That confession does not exist.");

    if (row.messageId) {
      const channel = await this.client.channels.fetch(row.channelId).catch(() => null);
      if (channel && channel.isTextBased()) {
        await (channel as TextChannel).messages.delete(row.messageId).catch(() => undefined);
      }
    }

    await this.db
      .update(confessions)
      .set({ deletedAt: new Date(), deletedBy: actorId })
      .where(eq(confessions.id, row.id));
  }

  async recentCount(guildId: string, authorId: string, hours: number): Promise<number> {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const rows = await this.db
      .select({ id: confessions.id })
      .from(confessions)
      .where(and(eq(confessions.guildId, guildId), eq(confessions.authorId, authorId), sql`${confessions.createdAt} >= ${cutoff}`));
    return rows.length;
  }
}
