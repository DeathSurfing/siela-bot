import { eq } from "drizzle-orm";
import {
  autoroleSettings,
  ensureGuild,
  guildSettings,
  musicSettings,
  tempvcSettings,
  welcomeSettings,
  type Database,
  type AutoRoleSettingsRow,
  type GuildSettingsRow,
  type MusicSettingsRow,
  type TempVcSettingsRow,
  type WelcomeSettingsRow,
} from "@siela/db";
import { prefixSchema, type AutoRoleUpdate, type MusicSettingsUpdate, type TempVcSettingsUpdate, type WelcomeUpdate } from "@siela/shared";

export class SettingsService {
  private prefixCache = new Map<string, string>();

  constructor(private readonly db: Database) {}

  async ensure(guildId: string): Promise<void> {
    await ensureGuild(this.db, guildId);
  }

  async getGuild(guildId: string): Promise<GuildSettingsRow> {
    await this.ensure(guildId);
    const [row] = await this.db
      .select()
      .from(guildSettings)
      .where(eq(guildSettings.guildId, guildId))
      .limit(1);
    if (!row) throw new Error("Failed to load guild settings");
    this.prefixCache.set(guildId, row.prefix);
    return row;
  }

  async getPrefix(guildId: string): Promise<string> {
    const cached = this.prefixCache.get(guildId);
    if (cached) return cached;
    const row = await this.getGuild(guildId);
    return row.prefix;
  }

  async setPrefix(guildId: string, prefix: string, actorId: string): Promise<string> {
    const parsed = prefixSchema.parse(prefix);
    await this.ensure(guildId);
    await this.db
      .update(guildSettings)
      .set({ prefix: parsed, updatedAt: new Date(), updatedBy: actorId })
      .where(eq(guildSettings.guildId, guildId));
    this.prefixCache.set(guildId, parsed);
    return parsed;
  }

  invalidatePrefix(guildId: string): void {
    this.prefixCache.delete(guildId);
  }

  async getWelcome(guildId: string): Promise<WelcomeSettingsRow> {
    await this.ensure(guildId);
    const [row] = await this.db
      .select()
      .from(welcomeSettings)
      .where(eq(welcomeSettings.guildId, guildId))
      .limit(1);
    if (!row) throw new Error("Failed to load welcome settings");
    return row;
  }

  async updateWelcome(guildId: string, patch: WelcomeUpdate, actorId: string): Promise<WelcomeSettingsRow> {
    await this.ensure(guildId);
    const values: Partial<typeof welcomeSettings.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: actorId,
    };
    if (patch.enabled !== undefined) values.enabled = patch.enabled;
    if (patch.channelId !== undefined) values.channelId = patch.channelId;
    if (patch.message !== undefined) values.message = patch.message;
    if (patch.embed !== undefined) values.embed = patch.embed;
    if (patch.card !== undefined) values.card = patch.card;
    if (patch.pingUser !== undefined) values.pingUser = patch.pingUser;
    if (patch.dmEnabled !== undefined) values.dmEnabled = patch.dmEnabled;
    if (patch.dmMessage !== undefined) values.dmMessage = patch.dmMessage;
    if (patch.goodbyeEnabled !== undefined) values.goodbyeEnabled = patch.goodbyeEnabled;
    if (patch.goodbyeChannelId !== undefined) values.goodbyeChannelId = patch.goodbyeChannelId;
    if (patch.goodbyeMessage !== undefined) values.goodbyeMessage = patch.goodbyeMessage;
    await this.db.update(welcomeSettings).set(values).where(eq(welcomeSettings.guildId, guildId));
    return this.getWelcome(guildId);
  }

  async getAutoRole(guildId: string): Promise<AutoRoleSettingsRow> {
    await this.ensure(guildId);
    const [row] = await this.db
      .select()
      .from(autoroleSettings)
      .where(eq(autoroleSettings.guildId, guildId))
      .limit(1);
    if (!row) throw new Error("Failed to load auto-role settings");
    return row;
  }

  async updateAutoRole(guildId: string, patch: AutoRoleUpdate, actorId: string): Promise<AutoRoleSettingsRow> {
    await this.ensure(guildId);
    const values: Partial<typeof autoroleSettings.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: actorId,
    };
    if (patch.enabled !== undefined) values.enabled = patch.enabled;
    if (patch.roleIds !== undefined) values.roleIds = [...new Set(patch.roleIds)];
    if (patch.includeBots !== undefined) values.includeBots = patch.includeBots;
    if (patch.minAccountAgeDays !== undefined) values.minAccountAgeDays = patch.minAccountAgeDays;
    if (patch.delayMs !== undefined) values.delayMs = patch.delayMs;
    await this.db.update(autoroleSettings).set(values).where(eq(autoroleSettings.guildId, guildId));
    return this.getAutoRole(guildId);
  }

  async getTempVc(guildId: string): Promise<TempVcSettingsRow> {
    await this.ensure(guildId);
    const [row] = await this.db
      .select()
      .from(tempvcSettings)
      .where(eq(tempvcSettings.guildId, guildId))
      .limit(1);
    if (!row) throw new Error("Failed to load temp VC settings");
    return row;
  }

  async updateTempVc(guildId: string, patch: TempVcSettingsUpdate, actorId: string): Promise<TempVcSettingsRow> {
    await this.ensure(guildId);
    const values: Partial<typeof tempvcSettings.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: actorId,
    };
    if (patch.enabled !== undefined) values.enabled = patch.enabled;
    if (patch.hubChannelId !== undefined) values.hubChannelId = patch.hubChannelId;
    if (patch.categoryId !== undefined) values.categoryId = patch.categoryId;
    if (patch.nameTemplate !== undefined) values.nameTemplate = patch.nameTemplate;
    if (patch.defaultUserLimit !== undefined) values.defaultUserLimit = patch.defaultUserLimit;
    if (patch.defaultLocked !== undefined) values.defaultLocked = patch.defaultLocked;
    if (patch.autoDelete !== undefined) values.autoDelete = patch.autoDelete;
    if (patch.graceSeconds !== undefined) values.graceSeconds = patch.graceSeconds;
    if (patch.maxChannels !== undefined) values.maxChannels = patch.maxChannels;
    if (patch.maxPerUser !== undefined) values.maxPerUser = patch.maxPerUser;
    await this.db.update(tempvcSettings).set(values).where(eq(tempvcSettings.guildId, guildId));
    return this.getTempVc(guildId);
  }

  async getMusic(guildId: string): Promise<MusicSettingsRow> {
    await this.ensure(guildId);
    const [row] = await this.db
      .select()
      .from(musicSettings)
      .where(eq(musicSettings.guildId, guildId))
      .limit(1);
    if (!row) throw new Error("Failed to load music settings");
    return row;
  }

  async updateMusic(guildId: string, patch: MusicSettingsUpdate, actorId: string): Promise<MusicSettingsRow> {
    await this.ensure(guildId);
    const values: Partial<typeof musicSettings.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: actorId,
    };
    if (patch.djRoleIds !== undefined) values.djRoleIds = [...new Set(patch.djRoleIds)];
    if (patch.defaultVolume !== undefined) values.defaultVolume = patch.defaultVolume;
    if (patch.maxQueueSize !== undefined) values.maxQueueSize = patch.maxQueueSize;
    if (patch.musicChannelId !== undefined) values.musicChannelId = patch.musicChannelId;
    if (patch.aloneTimeoutSeconds !== undefined) values.aloneTimeoutSeconds = patch.aloneTimeoutSeconds;
    await this.db.update(musicSettings).set(values).where(eq(musicSettings.guildId, guildId));
    return this.getMusic(guildId);
  }
}
