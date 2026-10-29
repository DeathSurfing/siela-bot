import { z } from "zod";

const booleanEnv = (defaultValue: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(defaultValue)
    .transform((value) => value === "true");

const configSchema = z.object({
  DASHBOARD_PASSWORD: z.string().min(12, "must be at least 12 characters"),
  DASHBOARD_SESSION_SECRET: z.string().min(32, "must be at least 32 characters"),
  DASHBOARD_HOST: z.string().default("0.0.0.0"),
  DASHBOARD_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DASHBOARD_TRUST_PROXY: booleanEnv("false"),
  DASHBOARD_SECURE_COOKIES: booleanEnv("false"),
  CONTROL_API_URL: z.string().url().default("http://bot-control:3001"),
  MCP_TOKEN: z.string().min(16, "must be at least 16 characters"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type DashboardConfig = z.infer<typeof configSchema>;

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
