import { z } from "zod";
import { MAX_CASINO_BET, MAX_STOCK_SHARES, MAX_WELCOME_MESSAGE, MAX_MUSIC_QUERY } from "./constants.js";

export const snowflakeSchema = z
  .string()
  .trim()
  .regex(/^\d{17,20}$/, "Expected a Discord snowflake");

export const optionalSnowflakeSchema = snowflakeSchema.nullable().optional();

export const prefixSchema = z
  .string()
  .trim()
  .min(1, "Prefix is required")
  .max(5, "Prefix must be at most 5 characters")
  .refine((value) => !/[\s@#/\\`]/.test(value), "Prefix contains a reserved character")
  .refine((value) => /[^A-Za-z0-9]/.test(value), "Prefix must contain a non-alphanumeric character");

export const interactionKindSchema = z.enum(["slap", "kiss", "hug", "chodu", "wuzu"]);

export const prefixSetSchema = z.object({ prefix: prefixSchema }).strict();

export const featureUpdateSchema = z
  .object({
    featureId: z.string().min(1).max(64),
    enabled: z.boolean(),
  })
  .strict();

export const featureBulkUpdateSchema = z
  .object({
    updates: z.array(featureUpdateSchema).min(1).max(50),
  })
  .strict();

export const welcomeUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    channelId: optionalSnowflakeSchema,
    message: z.string().max(MAX_WELCOME_MESSAGE).optional(),
    embed: z.boolean().optional(),
    card: z.boolean().optional(),
    pingUser: z.boolean().optional(),
    dmEnabled: z.boolean().optional(),
    dmMessage: z.string().max(MAX_WELCOME_MESSAGE).nullable().optional(),
    goodbyeEnabled: z.boolean().optional(),
    goodbyeChannelId: optionalSnowflakeSchema,
    goodbyeMessage: z.string().max(MAX_WELCOME_MESSAGE).nullable().optional(),
  })
  .strict();

export const autoroleUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    roleIds: z.array(snowflakeSchema).max(10).optional(),
    includeBots: z.boolean().optional(),
    minAccountAgeDays: z.number().int().min(0).max(365).optional(),
    delayMs: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

export const autoroleSyncSchema = z
  .object({
    dryRun: z.boolean().default(true),
    confirm: z.boolean().optional(),
  })
  .strict();

export const tempvcSettingsUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    hubChannelId: optionalSnowflakeSchema,
    categoryId: optionalSnowflakeSchema,
    nameTemplate: z.string().min(1).max(100).optional(),
    defaultUserLimit: z.number().int().min(0).max(99).optional(),
    defaultLocked: z.boolean().optional(),
    autoDelete: z.boolean().optional(),
    graceSeconds: z.number().int().min(0).max(600).optional(),
    maxChannels: z.number().int().min(1).max(100).optional(),
    maxPerUser: z.number().int().min(1).max(3).optional(),
  })
  .strict();

export const tempvcChannelUpdateSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    locked: z.boolean().optional(),
    userLimit: z.number().int().min(0).max(99).optional(),
  })
  .strict();

export const tempvcUserActionSchema = z
  .object({
    userId: snowflakeSchema,
  })
  .strict();

export const musicSettingsUpdateSchema = z
  .object({
    djRoleIds: z.array(snowflakeSchema).max(10).optional(),
    defaultVolume: z.number().int().min(0).max(150).optional(),
    maxQueueSize: z.number().int().min(1).max(500).optional(),
    musicChannelId: optionalSnowflakeSchema,
    aloneTimeoutSeconds: z.number().int().min(30).max(3600).optional(),
  })
  .strict();

export const countersQuerySchema = z
  .object({
    userId: snowflakeSchema.optional(),
    actorId: snowflakeSchema.optional(),
    targetId: snowflakeSchema.optional(),
    kind: interactionKindSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const countersResetSchema = z
  .object({
    scope: z.enum(["user", "pair", "kind", "all"]),
    userId: snowflakeSchema.optional(),
    actorId: snowflakeSchema.optional(),
    targetId: snowflakeSchema.optional(),
    kind: interactionKindSchema.optional(),
    confirm: z.literal(true),
  })
  .strict();

export const messageSendSchema = z
  .object({
    channelId: snowflakeSchema,
    content: z.string().min(1).max(2_000),
    confirm: z.literal(true),
  })
  .strict();

export const privacyDeleteSchema = z
  .object({
    userId: snowflakeSchema,
    confirm: z.literal(true),
  })
  .strict();

export const auditQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const stockTradeSchema = z
  .object({
    symbol: z.string().trim().min(1, "Symbol is required").max(8, "Symbol must be at most 8 characters").regex(/^[A-Za-z]+$/, "Symbol may only contain letters"),
    shares: z.number().int().positive("Shares must be a positive whole number").max(MAX_STOCK_SHARES, `Shares must be at most ${MAX_STOCK_SHARES}`),
  })
  .strict();

export const resolveKindSchema = z.enum(["channel", "voice", "role", "user"]);

export const resolveQuerySchema = z
  .object({
    q: z.string().trim().min(1, "Enter a name to search for").max(80, "Search text must be at most 80 characters"),
    kind: resolveKindSchema.optional(),
    limit: z.coerce.number().int().min(1).max(20).default(8),
  })
  .strict();

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export const birthdaySetSchema = z
  .object({
    month: z.number().int().min(1, "Month must be between 1 and 12").max(12, "Month must be between 1 and 12"),
    day: z.number().int().min(1, "Day must be between 1 and 31").max(31, "Day must be between 1 and 31"),
    year: z.number().int().min(1900, "Year must be between 1900 and the current year").nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.year != null && value.year > new Date().getUTCFullYear()) {
      ctx.addIssue({ code: "custom", path: ["year"], message: "Year must be between 1900 and the current year" });
    }
    const limit = value.month === 2 && value.year == null ? 29 : daysInMonth(value.year ?? 2000, value.month);
    if (value.day > limit) {
      ctx.addIssue({ code: "custom", path: ["day"], message: `Day must be between 1 and ${limit} for that month` });
    }
  });

export const nodeIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Node ID may only contain letters, numbers, dash, and underscore");

function withNodeId<T extends z.ZodRawShape>(shape: T) {
  return z.object({ ...shape, nodeId: nodeIdSchema.optional() }).strict();
}

export const musicPlaySchema = withNodeId({
  query: z.string().min(1).max(MAX_MUSIC_QUERY),
  voiceChannelId: snowflakeSchema.optional(),
  next: z.boolean().optional(),
});

export const musicJoinSchema = withNodeId({
    voiceChannelId: snowflakeSchema.optional(),
  });

export const musicVolumeSchema = withNodeId({
    volume: z.number().int().min(0).max(150),
  });

export const musicSeekSchema = withNodeId({
    positionMs: z.number().int().min(0),
  });

export const musicLoopSchema = withNodeId({
    mode: z.enum(["off", "track", "queue"]),
  });

export const musicRemoveSchema = withNodeId({
    index: z.number().int().min(1),
  });

export const musicMoveSchema = withNodeId({
    from: z.number().int().min(1),
    to: z.number().int().min(1),
  });

export const musicJumpSchema = withNodeId({
    index: z.number().int().min(1),
  });

export const musicAutoplaySchema = withNodeId({
    enabled: z.boolean(),
  });

export const musicFilterSchema = withNodeId({
    preset: z.enum(["off", "bassboost", "nightcore", "vaporwave"]),
  });

export const musicSkipSchema = withNodeId({
    count: z.number().int().min(1).max(50).default(1),
  });

export const musicNodeSchema = withNodeId({
  });

const gameIdSchema = z.string().trim().min(1).max(32);

export const cahHostSchema = z
  .object({
    channelId: snowflakeSchema,
    pointsGoal: z.number().int().min(1).max(50).optional(),
    maxPlayers: z.number().int().min(3).max(10).optional(),
  })
  .strict();

export const cahGameActionSchema = z.object({ gameId: gameIdSchema }).strict();

export const cahRoundActionSchema = z
  .object({
    gameId: gameIdSchema,
    roundIndex: z.number().int().min(0),
  })
  .strict();

export const tambolaGameActionSchema = z.object({ gameId: gameIdSchema }).strict();

const casinoRequestSchema = z
  .object({
    bet: z.number().int().positive().max(MAX_CASINO_BET),
    requestId: z
      .string()
      .trim()
      .min(8)
      .max(100)
      .regex(/^[A-Za-z0-9_-]+$/, "requestId may only contain letters, numbers, dash, and underscore"),
  })
  .strict();

export const casinoCoinflipSchema = casinoRequestSchema
  .extend({ side: z.enum(["heads", "tails"]) })
  .strict();

export const casinoSlotsSchema = casinoRequestSchema;

export const welcomeTestSchema = z
  .object({
    channelId: snowflakeSchema.optional(),
    message: z.string().max(MAX_WELCOME_MESSAGE).optional(),
  })
  .strict();

export const commandMetadataSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()),
  category: z.enum(["music", "social", "voice", "utility", "admin"]),
  description: z.string(),
  usage: z.string(),
  examples: z.array(z.string()),
  adminOnly: z.boolean(),
  nsfw: z.boolean(),
  cooldownMs: z.number(),
  slash: z.boolean(),
});

export const botStatusSchema = z.object({
  ready: z.boolean(),
  uptimeSeconds: z.number(),
  gatewayPing: z.number().nullable(),
  guildId: z.string().nullable(),
  database: z.enum(["up", "down"]),
  music: z.enum(["up", "down", "unknown"]),
  activePlayers: z.number(),
  activeTempVcs: z.number(),
  version: z.string(),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});

export type WelcomeUpdate = z.infer<typeof welcomeUpdateSchema>;
export type AutoRoleUpdate = z.infer<typeof autoroleUpdateSchema>;
export type AutoRoleSync = z.infer<typeof autoroleSyncSchema>;
export type TempVcSettingsUpdate = z.infer<typeof tempvcSettingsUpdateSchema>;
export type TempVcChannelUpdate = z.infer<typeof tempvcChannelUpdateSchema>;
export type MusicSettingsUpdate = z.infer<typeof musicSettingsUpdateSchema>;
export type CountersQuery = z.infer<typeof countersQuerySchema>;
export type CountersReset = z.infer<typeof countersResetSchema>;
export type ResolveKind = z.infer<typeof resolveKindSchema>;
export type ResolveQuery = z.infer<typeof resolveQuerySchema>;
export type StockTrade = z.infer<typeof stockTradeSchema>;
export type MusicPlayInput = z.infer<typeof musicPlaySchema>;
export type WelcomeTestInput = z.infer<typeof welcomeTestSchema>;
