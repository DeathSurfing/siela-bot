import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDashboardConfig } from "./config.js";
import type { ControlClient } from "./control-client.js";
import { createDashboardServer, resolvePublicPath } from "./server.js";
import { issueSession, csrfToken } from "./session.js";

const config = loadDashboardConfig({
  DASHBOARD_PASSWORD: "not-a-real-password-value",
  DASHBOARD_SESSION_SECRET: "not-a-real-session-secret-with-more-than-32-chars",
  MCP_TOKEN: "not-a-real-control-token",
  NODE_ENV: "test",
});

let publicDir: string;

beforeEach(async () => {
  publicDir = await mkdtemp(path.join(process.cwd(), ".dashboard-test-"));
  await mkdir(path.join(publicDir, "js"));
  await writeFile(path.join(publicDir, "index.html"), "dashboard");
  await writeFile(path.join(publicDir, "js", "app.js"), "console.log('dashboard')");
});

afterEach(async () => {
  if (publicDir) await rm(publicDir, { recursive: true, force: true });
});

function controlStub(overrides: Partial<ControlClient> = {}): ControlClient {
  return {
    getStatus: vi.fn().mockResolvedValue({ ready: true }),
    getGuilds: vi.fn().mockResolvedValue({ guilds: [] }),
    getFeatures: vi.fn().mockResolvedValue({ features: [] }),
    updateFeature: vi.fn().mockResolvedValue({ featureId: "welcome", enabled: false }),
    getAudit: vi.fn().mockResolvedValue({ entries: [] }),
    getMusic: vi.fn().mockResolvedValue({ queue: [] }),
    musicAction: vi.fn().mockResolvedValue({ ok: true }),
    getConfig: vi.fn().mockResolvedValue({}),
    patchConfig: vi.fn().mockResolvedValue({}),
    getCommands: vi.fn().mockResolvedValue({ commands: [] }),
    ...overrides,
  };
}

function sessionHeaders(): Record<string, string> {
  const cookie = issueSession(config.DASHBOARD_SESSION_SECRET);
  return {
    cookie: `siela_dashboard=${cookie}`,
    "x-csrf-token": csrfToken(cookie, config.DASHBOARD_SESSION_SECRET),
  };
}

describe("dashboard HTTP boundary", () => {
  it("serves health and static assets with security headers", async () => {
    const app = createDashboardServer({ config, publicDir, control: controlStub() });
    const health = await app.inject({ method: "GET", url: "/healthz" });
    const asset = await app.inject({ method: "GET", url: "/js/app.js" });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain("dashboard");
    expect(asset.headers["content-security-policy"]).toContain("default-src 'self'");
    await app.close();
  });

  it("rejects static path traversal", () => {
    expect(resolvePublicPath(publicDir, "../secret.txt")).toBeNull();
    expect(resolvePublicPath(publicDir, "%2e%2e%2fsecret.txt")).toBeNull();
    expect(resolvePublicPath(publicDir, "js/app.js")).toBe(path.join(publicDir, "js", "app.js"));
  });

  it("requires a valid session and CSRF token for mutations", async () => {
    const app = createDashboardServer({ config, publicDir, control: controlStub() });
    const denied = await app.inject({ method: "PATCH", url: "/api/guilds/123/features/welcome", payload: { enabled: false } });
    const mismatch = await app.inject({
      method: "PATCH",
      url: "/api/guilds/123/features/welcome",
      headers: { ...sessionHeaders(), "x-csrf-token": "wrong" },
      payload: { enabled: false },
    });

    expect(denied.statusCode).toBe(401);
    expect(mismatch.statusCode).toBe(403);
    await app.close();
  });

  it("issues an HttpOnly signed cookie and limits bad sign-in attempts", async () => {
    let now = 1_700_000_000_000;
    const app = createDashboardServer({ config, publicDir, control: controlStub(), now: () => now });
    const success = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { password: config.DASHBOARD_PASSWORD },
    });
    const cookie = success.headers["set-cookie"];

    expect(success.statusCode).toBe(200);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toContain(config.DASHBOARD_PASSWORD);
    expect(success.json()).toHaveProperty("csrfToken");
    await app.inject({ method: "POST", url: "/api/logout", headers: { cookie, "x-csrf-token": success.json().csrfToken }, payload: {} });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await app.inject({ method: "POST", url: "/api/login", payload: { password: "incorrect-password" } })).statusCode).toBe(401);
    }
    const limited = await app.inject({ method: "POST", url: "/api/login", payload: { password: "incorrect-password" } });
    expect(limited.statusCode).toBe(429);
    now += 5 * 60_000;
    expect((await app.inject({ method: "POST", url: "/api/login", payload: { password: "incorrect-password" } })).statusCode).toBe(401);
    await app.close();
  });

  it("marks the session cookie Secure when configured", async () => {
    const secureConfig = loadDashboardConfig({
      DASHBOARD_PASSWORD: "not-a-real-password-value",
      DASHBOARD_SESSION_SECRET: "not-a-real-session-secret-with-more-than-32-chars",
      MCP_TOKEN: "not-a-real-control-token",
      DASHBOARD_SECURE_COOKIES: "true",
      NODE_ENV: "test",
    });
    const app = createDashboardServer({ config: secureConfig, publicDir, control: controlStub() });
    const response = await app.inject({
      method: "POST",
      url: "/api/login",
      remoteAddress: "10.0.0.9",
      payload: { password: secureConfig.DASHBOARD_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain("Secure");
    await app.close();
  });

  it("maps a feature update to the fixed control API route", async () => {
    const control = controlStub();
    const app = createDashboardServer({ config, publicDir, control });
    const response = await app.inject({
      method: "PATCH",
      url: "/api/guilds/123456789/features/music-playback",
      headers: sessionHeaders(),
      payload: { enabled: false },
    });

    expect(response.statusCode).toBe(200);
    expect(control.updateFeature).toHaveBeenCalledWith("123456789", "music-playback", false);
    await app.close();
  });

  it("does not proxy unknown API paths or music actions", async () => {
    const control = controlStub();
    const app = createDashboardServer({ config, publicDir, control });
    const unknown = await app.inject({ method: "GET", url: "/api/proxy?path=/v1/status", headers: sessionHeaders() });
    const action = await app.inject({
      method: "POST",
      url: "/api/guilds/123/music/reboot",
      headers: sessionHeaders(),
      payload: {},
    });

    expect(unknown.statusCode).toBe(404);
    expect(action.statusCode).toBe(404);
    expect(control.getStatus).not.toHaveBeenCalled();
    expect(control.musicAction).not.toHaveBeenCalled();
    await app.close();
  });
});
