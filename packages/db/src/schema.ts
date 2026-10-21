import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const guildSettings = pgTable("guild_settings", {
  guildId: text("guild_id").primaryKey(),
  prefix: varchar("prefix", { length: 5 }).notNull().default("!"),
  locale: varchar("locale", { length: 10 }).notNull().default("en"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

export const welcomeSettings = pgTable("welcome_settings", {
  guildId: text("guild_id")
    .primaryKey()
    .references(() => guildSettings.guildId, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  channelId: text("channel_id"),
  message: text("message").notNull().default("Welcome {mention} to **{server}**!"),
  embed: boolean("embed").notNull().default(true),
  card: boolean("card").notNull().default(false),
  pingUser: boolean("ping_user").notNull().default(false),
  dmEnabled: boolean("dm_enabled").notNull().default(false),
  dmMessage: text("dm_message"),
  goodbyeEnabled: boolean("goodbye_enabled").notNull().default(false),
  goodbyeChannelId: text("goodbye_channel_id"),
  goodbyeMessage: text("goodbye_message"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

export const autoroleSettings = pgTable("autorole_settings", {
  guildId: text("guild_id")
    .primaryKey()
    .references(() => guildSettings.guildId, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  roleIds: text("role_ids").array().notNull().default(sql`'{}'::text[]`),
  includeBots: boolean("include_bots").notNull().default(false),
  minAccountAgeDays: integer("min_account_age_days").notNull().default(0),
  delayMs: integer("delay_ms").notNull().default(500),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

export const tempvcSettings = pgTable("tempvc_settings", {
  guildId: text("guild_id")
    .primaryKey()
    .references(() => guildSettings.guildId, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  hubChannelId: text("hub_channel_id"),
  categoryId: text("category_id"),
  nameTemplate: text("name_template").notNull().default("{user}'s VC"),
  defaultUserLimit: integer("default_user_limit").notNull().default(0),
  defaultLocked: boolean("default_locked").notNull().default(true),
  autoDelete: boolean("auto_delete").notNull().default(true),
  graceSeconds: integer("grace_seconds").notNull().default(30),
  maxChannels: integer("max_channels").notNull().default(50),
  maxPerUser: integer("max_per_user").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

export const musicSettings = pgTable("music_settings", {
  guildId: text("guild_id")
    .primaryKey()
    .references(() => guildSettings.guildId, { onDelete: "cascade" }),
  djRoleIds: text("dj_role_ids").array().notNull().default(sql`'{}'::text[]`),
  defaultVolume: integer("default_volume").notNull().default(80),
  maxQueueSize: integer("max_queue_size").notNull().default(100),
  musicChannelId: text("music_channel_id"),
  aloneTimeoutSeconds: integer("alone_timeout_seconds").notNull().default(120),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

export const musicSessions = pgTable("music_sessions", {
  guildId: text("guild_id")
    .primaryKey()
    .references(() => guildSettings.guildId, { onDelete: "cascade" }),
  state: jsonb("state").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const interactionCounters = pgTable(
  "interaction_counters",
  {
    guildId: text("guild_id").notNull(),
    actorId: text("actor_id").notNull(),
    targetId: text("target_id").notNull(),
    kind: text("kind").notNull(),
    count: integer("count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.actorId, table.targetId, table.kind] }),
    index("counters_guild_kind_count_idx").on(table.guildId, table.kind, table.count),
    index("counters_guild_target_kind_idx").on(table.guildId, table.targetId, table.kind),
    index("counters_guild_actor_kind_idx").on(table.guildId, table.actorId, table.kind),
  ],
);

export const interactionOptouts = pgTable(
  "interaction_optouts",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull().default("*"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId, table.kind] })],
);

export const tempVoiceChannels = pgTable(
  "temp_voice_channels",
  {
    channelId: text("channel_id").primaryKey(),
    guildId: text("guild_id").notNull(),
    ownerId: text("owner_id").notNull(),
    hubId: text("hub_id").notNull(),
    status: text("status").notNull().default("active"),
    locked: boolean("locked").notNull().default(true),
    userLimit: integer("user_limit").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    lastEmptyAt: timestamp("last_empty_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("tempvc_active_owner_uq")
      .on(table.guildId, table.ownerId)
      .where(sql`${table.status} = 'active'`),
    index("tempvc_guild_status_idx").on(table.guildId, table.status),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    guildId: text("guild_id").notNull(),
    actorId: text("actor_id"),
    actorType: text("actor_type").notNull(),
    source: text("source").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_guild_created_idx").on(table.guildId, table.createdAt),
    index("audit_action_created_idx").on(table.action, table.createdAt),
  ],
);

export type GuildSettingsRow = typeof guildSettings.$inferSelect;
export type WelcomeSettingsRow = typeof welcomeSettings.$inferSelect;
export type AutoRoleSettingsRow = typeof autoroleSettings.$inferSelect;
export type TempVcSettingsRow = typeof tempvcSettings.$inferSelect;
export type MusicSettingsRow = typeof musicSettings.$inferSelect;
export type MusicSessionRow = typeof musicSessions.$inferSelect;
export type CounterRow = typeof interactionCounters.$inferSelect;
export type OptoutRow = typeof interactionOptouts.$inferSelect;
export type TempVoiceChannelRow = typeof tempVoiceChannels.$inferSelect;
export type AuditRow = typeof auditLog.$inferSelect;
