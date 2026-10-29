import { describe, expect, it } from "vitest";
import { loadDashboardConfig } from "./config.js";

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
      CONTROL_API_URL: "http://bot-control:3001",
    });
  });
});
