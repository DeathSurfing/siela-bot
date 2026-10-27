import { readFileSync } from "node:fs";
import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/);
const optionalSnowflake = z.preprocess(
  (value) => (value === "" ? undefined : value),
  snowflake.optional(),
);

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);
const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);
const booleanString = (defaultValue: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(defaultValue)
    .transform((value) => value === "true");

const UPSTREAM_REPO_URL = "https://github.com/DeathSurfing/siela-nogseuui-seobeo-bot.git";

const logLevel = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

function readSecret(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const fileVar = `${name}_FILE`;
  const file = env[fileVar];
  if (file) {
    try {
      return readFileSync(file, "utf8").trim();
    } catch (error) {
      throw new Error(`Could not read ${fileVar}: ${(error as Error).message}`);
    }
  }
  return env[name];
}

function csv(value: string | undefined): string[] {
  return value
    ? value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    : [];
}

const botSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DISCORD_TOKEN: z.string().min(20, "DISCORD_TOKEN is required"),
  GUILD_ID: optionalSnowflake,
  DISCORD_CLIENT_ID: optionalSnowflake,
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  MUSIC_BACKEND: z.enum(["mpv", "ffmpeg"]).default("mpv"),
  YTDLP_PATH: z.string().default("yt-dlp"),
  MPV_PATH: z.string().default("mpv"),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  MCP_TOKEN: z.string().min(16, "MCP_TOKEN must be at least 16 characters"),
  CONTROL_API_HOST: z.string().default("0.0.0.0"),
  CONTROL_API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HEALTH_HOST: z.string().default("127.0.0.1"),
  HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  DEFAULT_PREFIX: z.string().default("!"),
  ADMIN_ROLE_IDS: z.string().optional(),
  BOT_OWNER_ID: optionalSnowflake,
  HF_TOKEN: z.string().optional(),
  LLM_URL: z.string().url().optional(),
  VALKEY_URL: z.string().url().optional(),
  EVENT_SCHEDULE_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  EVENT_PRAYER: z.enum(["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"]).default("Dhuhr"),
  NODE_ROLE: z.enum(["commander", "voice"]).default("commander"),
  NODE_ID: z.string().min(1).max(64).default("commander"),
  NODE_ADVERTISE_URL: z.string().url().optional(),
  WORKER_INTERNAL_HOST: z.string().default("0.0.0.0"),
  WORKER_INTERNAL_PORT: z.coerce.number().int().min(1).max(65535).default(3101),
  ROUTER_URL: z.string().url().optional(),

  LOG_LEVEL: logLevel.default("info"),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  TZ: z.string().default("UTC"),
});

const watchtowerSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: logLevel.default("info"),
  TZ: z.string().default("UTC"),

  // Source of truth. Point this at a fork to follow the fork instead.
  WATCHTOWER_REPO_URL: z.string().min(1).default(UPSTREAM_REPO_URL),
  WATCHTOWER_BRANCH: z.string().min(1).default("main"),
  // Absolute path of the checkout on the host. The compose overlay mounts it
  // at the same path so host Podman can resolve build contexts.
  WATCHTOWER_REPO_DIR: z.string().min(1, "WATCHTOWER_REPO_DIR is required"),

  WATCHTOWER_INTERVAL_SEC: z.coerce.number().int().min(15).max(86_400).default(60),
  WATCHTOWER_CI_GATE: z.enum(["auto", "required", "off"]).default("auto"),
  WATCHTOWER_CI_GRACE_SEC: z.coerce.number().int().min(0).max(3_600).default(180),
  WATCHTOWER_CI_TIMEOUT_SEC: z.coerce.number().int().min(60).max(7_200).default(900),
  WATCHTOWER_HEALTH_TIMEOUT_SEC: z.coerce.number().int().min(30).max(1_800).default(180),
  WATCHTOWER_BUILD_NETWORK: optionalString,
  WATCHTOWER_RUN_MIGRATIONS: booleanString("true"),
  WATCHTOWER_DRY_RUN: booleanString("false"),
  WATCHTOWER_STATE_DIR: z.string().min(1).default("/state"),

  WATCHTOWER_HTTP_HOST: z.string().default("0.0.0.0"),
  WATCHTOWER_HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(3003),
  WATCHTOWER_TOKEN: z.string().min(16, "WATCHTOWER_TOKEN must be at least 16 characters"),
  WATCHTOWER_NOTIFY_WEBHOOK_URL: optionalUrl,

  GH_TOKEN: optionalString,
});

export type BotConfig = z.infer<typeof botSchema> & {
  adminRoleIds: string[];
  botOwnerId: string | null;
  guildId: string | null;
  clientId: string | null;
};

export type WatchtowerConfig = z.infer<typeof watchtowerSchema>;

const routerSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  MCP_TOKEN: z.string().min(16, "MCP_TOKEN must be at least 16 characters"),
  ROUTER_HOST: z.string().default("0.0.0.0"),
  ROUTER_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  COMMANDER_URL: z.string().url().default("http://bot-control:3001"),
  // Fleet session: static fallback. Live membership comes from Valkey
  // heartbeats (siela:fleet:node:* with TTL) when VALKEY_URL is set.
  VALKEY_URL: z.string().url().optional(),
  // Guild scope for the session. Semaphore capacity counts only nodes
  // heartbeating for this guild: 1 for a lone commander, more with workers.
  GUILD_ID: optionalSnowflake,
  NODES: z.string().optional(),
  LOG_LEVEL: logLevel.default("info"),
  TZ: z.string().default("UTC"),
});

export type RouterConfig = z.infer<typeof routerSchema>;

export function loadRouterConfig(env: NodeJS.ProcessEnv = process.env): RouterConfig {
  const parsed = routerSchema.safeParse({
    ...env,
    MCP_TOKEN: readSecret("MCP_TOKEN", env) ?? env.MCP_TOKEN,
  });
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid router environment:\n${details}`);
  }
  return parsed.data;
}

export function loadBotConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const parsed = botSchema.safeParse({
    ...env,
    DISCORD_TOKEN: readSecret("DISCORD_TOKEN", env) ?? env.DISCORD_TOKEN,
    DATABASE_URL: readSecret("DATABASE_URL", env) ?? env.DATABASE_URL,
    MCP_TOKEN: readSecret("MCP_TOKEN", env) ?? env.MCP_TOKEN,
    HF_TOKEN: readSecret("HF_TOKEN", env) ?? env.HF_TOKEN,
    LLM_URL: readSecret("LLM_URL", env) ?? env.LLM_URL,
    VALKEY_URL: readSecret("VALKEY_URL", env) ?? env.VALKEY_URL,
  });
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${details}`);
  }
  return {
    ...parsed.data,
    adminRoleIds: csv(parsed.data.ADMIN_ROLE_IDS),
    botOwnerId: parsed.data.BOT_OWNER_ID ?? null,
    guildId: parsed.data.GUILD_ID ?? null,
    clientId: parsed.data.DISCORD_CLIENT_ID ?? null,
  };
}

export function loadWatchtowerConfig(env: NodeJS.ProcessEnv = process.env): WatchtowerConfig {
  const parsed = watchtowerSchema.safeParse({
    ...env,
    GH_TOKEN: readSecret("GH_TOKEN", env) ?? env.GH_TOKEN,
    WATCHTOWER_TOKEN: readSecret("WATCHTOWER_TOKEN", env) ?? env.WATCHTOWER_TOKEN,
  });
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid watchtower environment:\n${details}`);
  }
  return parsed.data;
}
