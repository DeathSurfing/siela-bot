import { readFileSync } from "node:fs";
import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/);
const optionalSnowflake = z.preprocess(
  (value) => (value === "" ? undefined : value),
  snowflake.optional(),
);

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
  TTS_URL: z.string().url().optional(),
  TTS_VOICES_DIR: z.string().default("/app/voices"),

  LOG_LEVEL: logLevel.default("info"),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  TZ: z.string().default("UTC"),
});

const mcpSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  MCP_TOKEN: z.string().min(16, "MCP_TOKEN must be at least 16 characters"),
  CONTROL_API_URL: z.string().url().default("http://bot-control:3001"),
  MCP_URL: z.string().url().default("http://mcp:8080/mcp"),
  MCP_TRANSPORT: z.enum(["http", "stdio"]).default("http"),
  MCP_HTTP_HOST: z.string().default("0.0.0.0"),
  MCP_HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  MCP_ALLOWED_ORIGINS: z.string().optional(),
  LOG_LEVEL: logLevel.default("info"),
  TZ: z.string().default("UTC"),
});

export type BotConfig = z.infer<typeof botSchema> & {
  adminRoleIds: string[];
  botOwnerId: string | null;
  guildId: string | null;
  clientId: string | null;
};

export type McpConfig = z.infer<typeof mcpSchema> & {
  allowedOrigins: string[];
};

export function loadBotConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const parsed = botSchema.safeParse({
    ...env,
    DISCORD_TOKEN: readSecret("DISCORD_TOKEN", env) ?? env.DISCORD_TOKEN,
    DATABASE_URL: readSecret("DATABASE_URL", env) ?? env.DATABASE_URL,
    MCP_TOKEN: readSecret("MCP_TOKEN", env) ?? env.MCP_TOKEN,
    HF_TOKEN: readSecret("HF_TOKEN", env) ?? env.HF_TOKEN,
    LLM_URL: readSecret("LLM_URL", env) ?? env.LLM_URL,
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

export function loadMcpConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const parsed = mcpSchema.safeParse({
    ...env,
    MCP_TOKEN: readSecret("MCP_TOKEN", env) ?? env.MCP_TOKEN,
  });
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid MCP environment:\n${details}`);
  }
  return {
    ...parsed.data,
    allowedOrigins: csv(parsed.data.MCP_ALLOWED_ORIGINS),
  };
}
