import { and, eq } from "drizzle-orm";
import { userBirthdays, type Database, type UserBirthdayRow } from "@siela/db";
import type { Client, TextChannel } from "discord.js";
import type { SettingsService } from "./settings.js";
import type { Logger } from "../lib/logger.js";

export class BirthdayService {
  private timer: NodeJS.Timeout | null = null;
  private lastRunDate: string | null = null;

  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly client: Client,
    private readonly logger: Logger,
  ) {}

  async get(guildId: string, userId: string): Promise<UserBirthdayRow | null> {
    const [row] = await this.db
      .select()
      .from(userBirthdays)
      .where(and(eq(userBirthdays.guildId, guildId), eq(userBirthdays.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async set(guildId: string, userId: string, month: number, day: number, birthYear?: number): Promise<UserBirthdayRow> {
    const [row] = await this.db
      .insert(userBirthdays)
      .values({ guildId, userId, month, day, birthYear })
      .onConflictDoUpdate({
        target: [userBirthdays.guildId, userBirthdays.userId],
        set: { month, day, birthYear, updatedAt: new Date() },
      })
      .returning();
    if (!row) throw new Error("Failed to save birthday");
    return row;
  }

  async clear(guildId: string, userId: string): Promise<void> {
    await this.db
      .delete(userBirthdays)
      .where(and(eq(userBirthdays.guildId, guildId), eq(userBirthdays.userId, userId)));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.processToday().catch((error) => this.logger.warn({ err: error }, "birthday processing failed"));
    }, 5 * 60 * 1000);
    this.timer.unref?.();
    setTimeout(() => {
      void this.processToday().catch((error) => this.logger.warn({ err: error }, "birthday processing failed"));
    }, 10_000).unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processToday(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastRunDate === today) return;
    const month = new Date().getUTCMonth() + 1;
    const day = new Date().getUTCDate();

    const rows = await this.db
      .select()
      .from(userBirthdays)
      .where(and(eq(userBirthdays.month, month), eq(userBirthdays.day, day)));

    for (const row of rows) {
      if (row.lastWishedDate === today) continue;
      await this.wish(row, today);
    }
    this.lastRunDate = today;
  }

  private async wish(row: UserBirthdayRow, today: string): Promise<void> {
    const guild = await this.client.guilds.fetch(row.guildId).catch(() => null);
    if (!guild) return;
    const user = await this.client.users.fetch(row.userId).catch(() => null);
    if (!user) return;

    const age = row.birthYear ? this.age(row.birthYear, row.month, row.day, today) : null;
    const content = age
      ? `🎉 Happy Birthday, <@${row.userId}>! 🎂 You're ${age} today!`
      : `🎉 Happy Birthday, <@${row.userId}>! 🎂`;

    try {
      const channelId = await this.settings.getBirthdayChannel(row.guildId);
      if (channelId) {
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (channel && channel.isTextBased()) {
          await (channel as TextChannel).send({ content, allowedMentions: { users: [row.userId] } });
        } else {
          await user.send(content);
        }
      } else {
        await user.send(content);
      }
    } catch (error) {
      this.logger.debug({ err: error, userId: row.userId }, "birthday wish failed");
    } finally {
      await this.db
        .update(userBirthdays)
        .set({ lastWishedDate: today, updatedAt: new Date() })
        .where(and(eq(userBirthdays.guildId, row.guildId), eq(userBirthdays.userId, row.userId)))
        .catch(() => undefined);
    }
  }

  private age(birthYear: number, month: number, day: number, today: string): number {
    const now = new Date(`${today}T00:00:00.000Z`);
    let age = now.getUTCFullYear() - birthYear;
    if (now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day)) {
      age -= 1;
    }
    return age;
  }
}