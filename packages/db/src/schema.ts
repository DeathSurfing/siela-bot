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
  levelingChannelId: text("leveling_channel_id"),
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
  message: text("message").notNull().default("𓆩♡𓆪 yooo {mention} just spawned in ⋆.𐙚 ̊Sierra's 서버~~!!!!\n\nbro really joined the server 😭\ndude does NOT know what they're getting into ...💀\n\nanyways welcome to this mentally unstable household\ntake a seat, start yapping, and pretend we're normal~~\n\n𖤐 read the rules before the mods get a new victim\n𖤐 yap in general\n𖤐 make friends or lurk like an npc\n\nhave fun gang 🗣️🔥"),
  embed: boolean("embed").notNull().default(true),
  card: boolean("card").notNull().default(true),
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
    xp: integer("xp").notNull().default(0),
    level: integer("level").notNull().default(0),
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
  (table) => [
    index("family_marriages_guild_spouse_a_idx").on(table.guildId, table.spouseA),
    index("family_marriages_guild_spouse_b_idx").on(table.guildId, table.spouseB),
    uniqueIndex("family_marriages_active_spouse_a_uq").on(table.guildId, table.spouseA).where(sql`${table.status} = 'active'`),
    uniqueIndex("family_marriages_active_spouse_b_uq").on(table.guildId, table.spouseB).where(sql`${table.status} = 'active'`),
  ],
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
  (table) => [
    index("family_children_guild_parent_idx").on(table.guildId, table.parentId),
    index("family_children_guild_child_idx").on(table.guildId, table.childId),
    uniqueIndex("family_children_active_uq").on(table.guildId, table.parentId, table.childId).where(sql`${table.status} = 'active'`),
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

export const economyMarkets = pgTable("economy_markets", {
  guildId: text("guild_id")
    .primaryKey()
    .references(() => guildSettings.guildId, { onDelete: "cascade" }),
  lastTickAt: timestamp("last_tick_at", { withTimezone: true }).notNull().defaultNow(),
  tickCount: bigint("tick_count", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const economyStocks = pgTable(
  "economy_stocks",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guildSettings.guildId, { onDelete: "cascade" }),
    symbol: varchar("symbol", { length: 8 }).notNull(),
    name: text("name").notNull(),
    sector: text("sector").notNull(),
    description: text("description").notNull(),
    price: bigint("price", { mode: "number" }).notNull(),
    fairValue: bigint("fair_value", { mode: "number" }).notNull(),
    volatility: integer("volatility").notNull(),
    history: jsonb("history").$type<number[]>().notNull().default([]),
    lastEvent: text("last_event"),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.guildId, t.symbol] }),
    check("economy_stock_price_positive", sql`${t.price} > 0`),
  ],
);

export const economyHoldings = pgTable(
  "economy_holdings",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guildSettings.guildId, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    symbol: varchar("symbol", { length: 8 }).notNull(),
    shares: bigint("shares", { mode: "number" }).notNull().default(0),
    avgCost: bigint("avg_cost", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.guildId, t.userId, t.symbol] }),
    check("economy_holding_shares_nonneg", sql`${t.shares} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Siela Relics: one-of-one trading cards, daily auctions, trades, and profiles
// ---------------------------------------------------------------------------

export const relicSettings = pgTable(
  "relic_settings",
  {
    guildId: text("guild_id")
      .primaryKey()
      .references(() => guildSettings.guildId, { onDelete: "cascade" }),
    channelId: text("channel_id"),
    enabled: boolean("enabled").notNull().default(false),
    startHourIst: integer("start_hour_ist").notNull().default(16),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    startingBid: integer("starting_bid").notNull().default(25),
    minIncrement: integer("min_increment").notNull().default(10),
    pingRoleId: text("ping_role_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by"),
  },
  (t) => [check("relic_settings_hour_ck", sql`${t.startHourIst} >= 0 AND ${t.startHourIst} <= 23`)],
);

export const relicCards = pgTable(
  "relic_cards",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guildSettings.guildId, { onDelete: "cascade" }),
    subjectKey: varchar("subject_key", { length: 64 }).notNull(),
    name: text("name").notNull(),
    variantKey: varchar("variant_key", { length: 32 }).notNull(),
    rarity: varchar("rarity", { length: 16 }).notNull(),
    seed: bigint("seed", { mode: "number" }).notNull(),
    power: integer("power").notNull(),
    chaos: integer("chaos").notNull(),
    luck: integer("luck").notNull(),
    aura: integer("aura").notNull(),
    rating: integer("rating").notNull(),
    lore: text("lore").notNull(),
    emoji: varchar("emoji", { length: 16 }).notNull(),
    palette: jsonb("palette").$type<string[]>().notNull().default([]),
    sigil: varchar("sigil", { length: 16 }).notNull(),
    foil: varchar("foil", { length: 16 }).notNull(),
    isGenesis: boolean("is_genesis").notNull().default(false),
    auctionId: bigint("auction_id", { mode: "number" }),
    ownerId: text("owner_id"),
    mintedAt: timestamp("minted_at", { withTimezone: true }),
    mintedPrice: bigint("minted_price", { mode: "number" }),
    acquiredVia: varchar("acquired_via", { length: 16 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("relic_card_seed_uq").on(t.guildId, t.seed),
    index("relic_card_owner_idx").on(t.guildId, t.ownerId),
    index("relic_card_rarity_idx").on(t.guildId, t.rarity),
    check(
      "relic_card_rarity_ck",
      sql`${t.rarity} IN ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic')`,
    ),
    check("relic_card_stats_ck", sql`${t.power} BETWEEN 1 AND 99 AND ${t.chaos} BETWEEN 1 AND 99 AND ${t.luck} BETWEEN 1 AND 99 AND ${t.aura} BETWEEN 1 AND 99`),
  ],
);

export const relicAuctions = pgTable(
  "relic_auctions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guildSettings.guildId, { onDelete: "cascade" }),
    cardId: bigint("card_id", { mode: "number" })
      .notNull()
      .references(() => relicCards.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull(),
    messageId: text("message_id"),
    slot: varchar("slot", { length: 48 }).notNull(),
    dropDate: varchar("drop_date", { length: 10 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("live"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    startingBid: integer("starting_bid").notNull(),
    minIncrement: integer("min_increment").notNull(),
    highestBid: bigint("highest_bid", { mode: "number" }).notNull().default(0),
    highestBidderId: text("highest_bidder_id"),
    bidCount: integer("bid_count").notNull().default(0),
    winnerId: text("winner_id"),
    winningBid: bigint("winning_bid", { mode: "number" }),
    winningBidId: bigint("winning_bid_id", { mode: "number" }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    announcedAt: timestamp("announced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("relic_auction_slot_uq").on(t.guildId, t.slot),
    uniqueIndex("relic_auction_live_uq").on(t.guildId).where(sql`${t.status} = 'live'`),
    index("relic_auction_status_idx").on(t.status, t.endsAt),
    index("relic_auction_message_idx").on(t.messageId),
    check("relic_auction_status_ck", sql`${t.status} IN ('live', 'settled', 'cancelled')`),
    check("relic_auction_bid_ck", sql`${t.highestBid} >= 0 AND ${t.bidCount} >= 0`),
  ],
);

export const relicBids = pgTable(
  "relic_bids",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    auctionId: bigint("auction_id", { mode: "number" })
      .notNull()
      .references(() => relicAuctions.id, { onDelete: "cascade" }),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("relic_bid_auction_idx").on(t.auctionId, t.status),
    uniqueIndex("relic_bid_active_uq").on(t.auctionId).where(sql`${t.status} = 'active'`),
    index("relic_bid_user_idx").on(t.guildId, t.userId, t.createdAt),
    check("relic_bid_amount_ck", sql`${t.amount} > 0`),
    check("relic_bid_status_ck", sql`${t.status} IN ('active', 'outbid', 'won', 'refunded', 'cancelled')`),
  ],
);

export const relicInventory = pgTable(
  "relic_inventory",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guildSettings.guildId, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    cardId: bigint("card_id", { mode: "number" })
      .notNull()
      .references(() => relicCards.id, { onDelete: "cascade" }),
    acquiredVia: varchar("acquired_via", { length: 16 }).notNull().default("auction"),
    acquiredPrice: bigint("acquired_price", { mode: "number" }).notNull().default(0),
    lastYieldAt: timestamp("last_yield_at", { withTimezone: true }).notNull().defaultNow(),
    lockedTradeId: bigint("locked_trade_id", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("relic_inventory_card_uq").on(t.cardId),
    index("relic_inventory_user_idx").on(t.guildId, t.userId, t.createdAt),
    index("relic_inventory_trade_idx").on(t.lockedTradeId),
  ],
);

export const relicProfiles = pgTable(
  "relic_profiles",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guildSettings.guildId, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    featuredCardId: bigint("featured_card_id", { mode: "number" }),
    totalYieldClaimed: bigint("total_yield_claimed", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.userId] })],
);

export const relicTrades = pgTable(
  "relic_trades",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guildSettings.guildId, { onDelete: "cascade" }),
    proposerId: text("proposer_id").notNull(),
    partnerId: text("partner_id").notNull(),
    offerCardId: bigint("offer_card_id", { mode: "number" }).notNull(),
    requestCardId: bigint("request_card_id", { mode: "number" }),
    coins: bigint("coins", { mode: "number" }).notNull().default(0),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    channelId: text("channel_id"),
    messageId: text("message_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("relic_trade_status_idx").on(t.status, t.expiresAt),
    index("relic_trade_user_idx").on(t.guildId, t.proposerId),
    index("relic_trade_partner_idx").on(t.guildId, t.partnerId),
    check("relic_trade_coins_ck", sql`${t.coins} >= 0`),
    check("relic_trade_status_ck", sql`${t.status} IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')`),
  ],
);

export type RelicSettingsRow = typeof relicSettings.$inferSelect;
export type RelicCardRow = typeof relicCards.$inferSelect;
export type RelicAuctionRow = typeof relicAuctions.$inferSelect;
export type RelicBidRow = typeof relicBids.$inferSelect;
export type RelicInventoryRow = typeof relicInventory.$inferSelect;
export type RelicProfileRow = typeof relicProfiles.$inferSelect;
export type RelicTradeRow = typeof relicTrades.$inferSelect;
