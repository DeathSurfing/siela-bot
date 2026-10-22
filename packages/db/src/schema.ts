import { sql } from "drizzle-orm";
import {
  bigserial,
  bigint,
  check,
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
  birthdayChannelId: text("birthday_channel_id"),
  confessionChannelId: text("confession_channel_id"),
  confessionCounter: integer("confession_counter").notNull().default(0),
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

export const userBirthdays = pgTable(
  "user_birthdays",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guildSettings.guildId, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    month: integer("month").notNull(),
    day: integer("day").notNull(),
    birthYear: integer("birth_year"),
    lastWishedDate: varchar("last_wished_date", { length: 10 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId] })],
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

export const userBiases = pgTable(
  "user_biases",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guildSettings.guildId, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    bias: varchar("bias", { length: 32 }).notNull(),
    biasWrecker: varchar("bias_wrecker", { length: 32 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId] })],
);

export const friendshipLevels = pgTable(
  "friendship_levels",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guildSettings.guildId, { onDelete: "cascade" }),
    userA: text("user_a").notNull(),
    userB: text("user_b").notNull(),
    xp: integer("xp").notNull().default(0),
    timeTogetherSeconds: integer("time_together_seconds").notNull().default(0),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userA, table.userB] })],
);

export const memberActivity = pgTable(
  "member_activity",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guildSettings.guildId, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    messages: integer("messages").notNull().default(0),
    commands: integer("commands").notNull().default(0),
    reactions: integer("reactions").notNull().default(0),
    voiceSeconds: integer("voice_seconds").notNull().default(0),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId] })],
);

export const confessions = pgTable(
  "confessions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guildSettings.guildId, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull(),
    authorId: text("author_id").notNull(),
    number: integer("number").notNull(),
    content: text("content").notNull(),
    messageId: text("message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
  },
  (table) => [uniqueIndex("confessions_guild_number_uq").on(table.guildId, table.number)],
);

export const familyMarriages = pgTable(
  "family_marriages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guildSettings.guildId, { onDelete: "cascade" }),
    spouseA: text("spouse_a").notNull(),
    spouseB: text("spouse_b").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    marriedAt: timestamp("married_at", { withTimezone: true }).notNull().defaultNow(),
    divorcedAt: timestamp("divorced_at", { withTimezone: true }),
    divorcedBy: text("divorced_by"),
  },
  (table) => [index("family_marriages_guild_spouse_a_idx").on(table.guildId, table.spouseA), index("family_marriages_guild_spouse_b_idx").on(table.guildId, table.spouseB)],
);

export const familyChildren = pgTable(
  "family_children",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guildSettings.guildId, { onDelete: "cascade" }),
    parentId: text("parent_id").notNull(),
    childId: text("child_id").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedBy: text("ended_by"),
  },
  (table) => [index("family_children_guild_parent_idx").on(table.guildId, table.parentId), index("family_children_guild_child_idx").on(table.guildId, table.childId)],
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
export type CounterRow = typeof interactionCounters.$inferSelect;
export type UserBiasRow = typeof userBiases.$inferSelect;
export type OptoutRow = typeof interactionOptouts.$inferSelect;
export type UserBirthdayRow = typeof userBirthdays.$inferSelect;
export type FriendshipLevelRow = typeof friendshipLevels.$inferSelect;
export type MemberActivityRow = typeof memberActivity.$inferSelect;
export type ConfessionRow = typeof confessions.$inferSelect;
export type FamilyMarriageRow = typeof familyMarriages.$inferSelect;
export type FamilyChildRow = typeof familyChildren.$inferSelect;
export type TempVoiceChannelRow = typeof tempVoiceChannels.$inferSelect;
export type AuditRow = typeof auditLog.$inferSelect;


export const economyAccounts = pgTable(
  "economy_accounts",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guildSettings.guildId, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    balance: bigint("balance", { mode: "number" }).notNull().default(0),
    lastDailyAt: timestamp("last_daily_at", { withTimezone: true }),
    lastWorkAt: timestamp("last_work_at", { withTimezone: true }),
    dailyStreak: integer("daily_streak").notNull().default(0),
    totalEarned: bigint("total_earned", { mode: "number" }).notNull().default(0),
    totalSpent: bigint("total_spent", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.guildId, t.userId] }),
    check("economy_balance_nonneg", sql`${t.balance} >= 0`),
  ],
);

export const economyTransactions = pgTable(
  "economy_transactions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    guildId: text("guild_id").notNull(),
    fromUserId: text("from_user_id"),
    toUserId: text("to_user_id"),
    amount: bigint("amount", { mode: "number" }).notNull(),
    kind: text("kind").notNull(),
    reason: text("reason"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("economy_tx_idempotency_uq").on(t.guildId, t.idempotencyKey).where(sql`${t.idempotencyKey} IS NOT NULL`),
    index("economy_tx_guild_created_idx").on(t.guildId, t.createdAt),
  ],
);

export const premiumPasses = pgTable(
  "premium_passes",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    grantedBy: text("granted_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.userId] })],
);


export const economyShopItems = pgTable(
  "economy_shop_items",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guildSettings.guildId, { onDelete: "cascade" }),
    key: varchar("key", { length: 32 }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    price: integer("price").notNull(),
    roleId: text("role_id"),
    stock: integer("stock"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("economy_shop_item_key_uq").on(t.guildId, t.key)],
);

export const economyInventory = pgTable(
  "economy_inventory",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    itemKey: varchar("item_key", { length: 32 }).notNull(),
    quantity: integer("quantity").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("economy_inventory_user_item_uq").on(t.guildId, t.userId, t.itemKey)],
);
