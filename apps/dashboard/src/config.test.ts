import { describe, expect, it } from "vitest";
import { loadDashboardConfig, oauthConfig } from "./config.js";

describe("dashboard environment", () => {
  it("requires a 12-character password, a 32-character session secret, and a control token", () => {
    expect(() => loadDashboardConfig({})).toThrow("DASHBOARD_PASSWORD: Invalid input: expected string, received undefined");
    expect(() => loadDashboardConfig({
      DASHBOARD_PASSWORD: "short",
      DASHBOARD_SESSION_SECRET: "too-short",
      MCP_TOKEN: "short",
    })).toThrow("DASHBOARD_SESSION_SECRET: must be at least 32 characters");
  });

  it("uses the documented listener and control API defaults", () => {
    const config = loadDashboardConfig({
      DASHBOARD_PASSWORD: "a-long-dashboard-password",
      DASHBOARD_SESSION_SECRET: "a-session-secret-with-at-least-thirty-two-characters",
      MCP_TOKEN: "a-long-control-token-value",
    });

    expect(config).toMatchObject({
      DASHBOARD_HOST: "0.0.0.0",
      DASHBOARD_PORT: 3000,
      DASHBOARD_TRUST_PROXY: false,
      DASHBOARD_SECURE_COOKIES: false,
      CONTROL_API_URL: "http://bot-control:3001",
    });
  });

  it("requires the Discord OAuth settings together", () => {
    const base = {
      DASHBOARD_PASSWORD: "a-long-dashboard-password",
      DASHBOARD_SESSION_SECRET: "a-session-secret-with-at-least-thirty-two-characters",
      MCP_TOKEN: "a-long-control-token-value",
    };
    expect(() => loadDashboardConfig({ ...base, DISCORD_CLIENT_ID: "111111111111111111" })).not.toThrow();
    expect(() => loadDashboardConfig({ ...base, DISCORD_CLIENT_ID: "111111111111111111", DISCORD_CLIENT_SECRET: "a-long-discord-client-secret" })).toThrow(/together/);
    expect(() => loadDashboardConfig({
      ...base,
      DISCORD_CLIENT_ID: "111111111111111111",
      DISCORD_CLIENT_SECRET: "a-long-discord-client-secret",
      DASHBOARD_OAUTH_REDIRECT_URI: "http://localhost:3000/auth/discord/callback",
      DASHBOARD_OWNER_IDS: "111111111111111111, 222222222222222222",
    })).not.toThrow();
  });

  it("parses the OAuth allowlist", () => {
    const config = loadDashboardConfig({
      DASHBOARD_PASSWORD: "a-long-dashboard-password",
      DASHBOARD_SESSION_SECRET: "a-session-secret-with-at-least-thirty-two-characters",
      MCP_TOKEN: "a-long-control-token-value",
      DISCORD_CLIENT_ID: "111111111111111111",
      DISCORD_CLIENT_SECRET: "a-long-discord-client-secret",
      DASHBOARD_OAUTH_REDIRECT_URI: "http://localhost:3000/auth/discord/callback",
      DASHBOARD_OWNER_IDS: "111111111111111111,222222222222222222",
    });
    expect(oauthConfig(config)?.ownerIds).toEqual(["111111111111111111", "222222222222222222"]);
  });

  it("parses the proxy and cookie flags", () => {
    const config = loadDashboardConfig({
      DASHBOARD_PASSWORD: "a-long-dashboard-password",
      DASHBOARD_SESSION_SECRET: "a-session-secret-with-at-least-thirty-two-characters",
      MCP_TOKEN: "a-long-control-token-value",
      DASHBOARD_TRUST_PROXY: "true",
      DASHBOARD_SECURE_COOKIES: "true",
    });
    expect(config.DASHBOARD_TRUST_PROXY).toBe(true);
    expect(config.DASHBOARD_SECURE_COOKIES).toBe(true);
  });
});
