import { z } from "zod";
import { MAX_WELCOME_MESSAGE, MAX_MUSIC_QUERY } from "./constants.js";

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

export const interactionKindSchema = z.enum(["slap", "kiss", "hug", "chodu"]);

export const prefixSetSchema = z.object({ prefix: prefixSchema }).strict();

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

export const translateTextSchema = z
  .object({
    text: z.string().min(1).max(2_000),
  })
  .strict();

export const translateMessageSchema = z
  .object({
    channelId: snowflakeSchema,
    messageId: snowflakeSchema,
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

export const musicPlaySchema = z
  .object({
    query: z.string().min(1).max(MAX_MUSIC_QUERY),
    voiceChannelId: snowflakeSchema.optional(),
    next: z.boolean().optional(),
  })
  .strict();

export const musicVolumeSchema = z
  .object({
    volume: z.number().int().min(0).max(150),
  })
  .strict();

export const musicSeekSchema = z
  .object({
    positionMs: z.number().int().min(0),
  })
  .strict();

export const musicLoopSchema = z
  .object({
    mode: z.enum(["off", "track", "queue"]),
  })
  .strict();

export const musicRemoveSchema = z
  .object({
    index: z.number().int().min(1),
  })
  .strict();

export const musicMoveSchema = z
  .object({
    from: z.number().int().min(1),
    to: z.number().int().min(1),
  })
  .strict();

export const musicJumpSchema = z
  .object({
    index: z.number().int().min(1),
  })
  .strict();

export const musicAutoplaySchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

export const musicFilterSchema = z
  .object({
    preset: z.enum(["off", "bassboost", "nightcore", "vaporwave"]),
  })
  .strict();

export const musicSkipSchema = z
  .object({
    count: z.number().int().min(1).max(50).default(1),
  })
  .strict();

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
  translation: z.enum(["up", "down", "unknown"]),
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
export type MusicPlayInput = z.infer<typeof musicPlaySchema>;
export type WelcomeTestInput = z.infer<typeof welcomeTestSchema>;
