import { z } from "zod";

const booleanEnv = (defaultValue: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(defaultValue)
    .transform((value) => value === "true");

const snowflake = z.string().regex(/^\d{17,20}$/, "must be a Discord snowflake");

const configSchema = z
  .object({
    DASHBOARD_PASSWORD: z.string().min(12, "must be at least 12 characters"),
    DASHBOARD_SESSION_SECRET: z.string().min(32, "must be at least 32 characters"),
    DASHBOARD_HOST: z.string().default("0.0.0.0"),
    DASHBOARD_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DASHBOARD_TRUST_PROXY: booleanEnv("false"),
    DASHBOARD_SECURE_COOKIES: booleanEnv("false"),
    CONTROL_API_URL: z.string().url().default("http://bot-control:3001"),
    MCP_TOKEN: z.string().min(16, "must be at least 16 characters"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DISCORD_CLIENT_ID: z.preprocess((value) => (value === "" ? undefined : value), snowflake.optional()),
    DISCORD_CLIENT_SECRET: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(10, "must be the Discord application client secret").optional(),
    ),
    DASHBOARD_OAUTH_REDIRECT_URI: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().url("must be the full public callback URL").optional(),
    ),
    DASHBOARD_OWNER_IDS: z.preprocess((value) => (value === "" ? undefined : value), z.string().optional()),
  })
  .superRefine((value, context) => {
    const oauthFields = [
      value.DISCORD_CLIENT_SECRET,
      value.DASHBOARD_OAUTH_REDIRECT_URI,
      value.DASHBOARD_OWNER_IDS,
    ];
    const provided = oauthFields.filter(Boolean).length;
    if (provided === 0) return;
    if (provided < oauthFields.length || !value.DISCORD_CLIENT_ID) {
      context.addIssue({
        code: "custom",
        path: ["DASHBOARD_OAUTH_REDIRECT_URI"],
        message:
          "Discord OAuth needs DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DASHBOARD_OAUTH_REDIRECT_URI, and DASHBOARD_OWNER_IDS together. Leave the secret, redirect, and owner list empty to disable it.",
      });
      return;
    }
    const owners = value.DASHBOARD_OWNER_IDS!.split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (owners.length === 0) {
      context.addIssue({ code: "custom", path: ["DASHBOARD_OWNER_IDS"], message: "must list at least one Discord user ID" });
      return;
    }
    const invalid = owners.filter((id) => !snowflake.safeParse(id).success);
    if (invalid.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["DASHBOARD_OWNER_IDS"],
        message: `not a Discord snowflake: ${invalid.join(", ")}`,
      });
    }
  });

export type DashboardConfig = z.infer<typeof configSchema>;

export interface DashboardOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  ownerIds: string[];
}

export function oauthConfig(config: DashboardConfig): DashboardOAuthConfig | null {
  if (!config.DISCORD_CLIENT_ID || !config.DISCORD_CLIENT_SECRET || !config.DASHBOARD_OAUTH_REDIRECT_URI || !config.DASHBOARD_OWNER_IDS) {
    return null;
  }
  return {
    clientId: config.DISCORD_CLIENT_ID,
    clientSecret: config.DISCORD_CLIENT_SECRET,
    redirectUri: config.DASHBOARD_OAUTH_REDIRECT_URI,
    ownerIds: [...new Set(config.DASHBOARD_OWNER_IDS.split(",").map((id) => id.trim()).filter(Boolean))],
  };
}

export function loadDashboardConfig(env: NodeJS.ProcessEnv = process.env): DashboardConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid dashboard environment:\n${issues}`);
  }
  return parsed.data;
}
