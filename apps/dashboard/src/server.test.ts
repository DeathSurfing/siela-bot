import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDashboardConfig } from "./config.js";
import type { ControlClient } from "./control-client.js";
import { createDashboardServer, resolvePublicPath } from "./server.js";
import { issueSession, csrfToken, type SessionUser } from "./session.js";

const password = "not-a-real-password-value";
const sessionSecret = "not-a-real-session-secret-with-more-than-32-chars";
const config = loadDashboardConfig({
  DASHBOARD_PASSWORD: password,
  DASHBOARD_SESSION_SECRET: sessionSecret,
  MCP_TOKEN: "not-a-real-control-token",
  NODE_ENV: "test",
});
const oauthOnlyConfig = loadDashboardConfig({
  DASHBOARD_SESSION_SECRET: sessionSecret,
  MCP_TOKEN: "not-a-real-control-token",
  DISCORD_CLIENT_ID: "123456789012345678",
  DISCORD_CLIENT_SECRET: "not-a-real-discord-client-secret",
  DASHBOARD_OAUTH_REDIRECT_URI: "http://localhost:3000/auth/discord/callback",
  DASHBOARD_OWNER_IDS: "111111111111111111",
  NODE_ENV: "test",
});

let publicDir: string;

beforeEach(async () => {
  publicDir = await mkdtemp(path.join(process.cwd(), ".dashboard-test-"));
  await mkdir(path.join(publicDir, "js"));
  await writeFile(path.join(publicDir, "index.html"), "dashboard");
  await writeFile(path.join(publicDir, "js", "app.js"), "console.log('dashboard')");
  await writeFile(path.join(publicDir, "font.woff2"), "font");
});

afterEach(async () => {
  if (publicDir) await rm(publicDir, { recursive: true, force: true });
});

const owner: SessionUser = { id: "111111111111111111", name: "Owner", avatarUrl: null };

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
    authorize: vi.fn().mockResolvedValue({ administrator: true, user: { id: owner.id, name: owner.name } }),
    getBirthday: vi.fn().mockResolvedValue({ birthday: null }),
    setBirthday: vi.fn().mockResolvedValue({ month: 1, day: 1, birthYear: null }),
    clearBirthday: vi.fn().mockResolvedValue({ ok: true }),
    cahState: vi.fn().mockResolvedValue({ enabled: true, game: null }),
    cahHost: vi.fn().mockResolvedValue({ enabled: true, game: null }),
    cahAction: vi.fn().mockResolvedValue({ enabled: true, game: null }),
    tambolaState: vi.fn().mockResolvedValue({ enabled: true, game: null }),
    tambolaAction: vi.fn().mockResolvedValue({ enabled: true, game: null }),
    casinoState: vi.fn().mockResolvedValue({ enabled: true, balance: 500, maxBet: 10_000 }),
    casinoPlay: vi.fn().mockResolvedValue({ enabled: true, balance: 500, game: "coinflip", payout: 0 }),
    ...overrides,
  };
}

function sessionHeaders(user: SessionUser | null = null): Record<string, string> {
  const cookie = issueSession(config.DASHBOARD_SESSION_SECRET, Date.now(), user ?? undefined);
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
    const index = await app.inject({ method: "GET", url: "/" });
    const font = await app.inject({ method: "GET", url: "/font.woff2" });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain("dashboard");
    expect(asset.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(asset.headers["cache-control"]).toBe("no-store");
    expect(index.headers["cache-control"]).toBe("no-store");
    expect(font.statusCode).toBe(200);
    expect(font.headers["content-type"]).toBe("font/woff2");
    expect(font.headers["cache-control"]).toBe("public, max-age=3600");
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
      payload: { password },
    });
    const cookie = success.headers["set-cookie"];

    expect(success.statusCode).toBe(200);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain(password);
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

  it("reports whether Discord OAuth is available", async () => {
    const app = createDashboardServer({ config, publicDir, control: controlStub() });
    const session = await app.inject({ method: "GET", url: "/api/session" });
    expect(session.json()).toEqual({ authenticated: false, oauth: false, password: true });
    expect((await app.inject({ method: "GET", url: "/auth/discord" })).statusCode).toBe(404);
    await app.close();
  });

  it("reports the password flag in authenticated and unauthenticated sessions", async () => {
    const app = createDashboardServer({ config, publicDir, control: controlStub() });
    const authenticated = await app.inject({ method: "GET", url: "/api/session", headers: sessionHeaders() });

    expect(authenticated.json()).toMatchObject({ authenticated: true, oauth: false, password: true });
    await app.close();
  });

  it("disables password sign-in when no password is configured", async () => {
    const app = createDashboardServer({ config: oauthOnlyConfig, publicDir, control: controlStub() });
    const session = await app.inject({ method: "GET", url: "/api/session" });
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { password: "anything-at-all" } });

    expect(session.json()).toEqual({ authenticated: false, oauth: true, password: false });
    expect(login.statusCode).toBe(404);
    expect(login.json()).toEqual({ error: { code: "password_disabled", message: expect.any(String) } });
    expect(login.headers["set-cookie"]).toBeUndefined();
    await app.close();
  });

  it("runs the Discord state, callback, owner, and session flow", async () => {
    const oauthSettings = loadDashboardConfig({
      DASHBOARD_PASSWORD: "not-a-real-password-value",
      DASHBOARD_SESSION_SECRET: "not-a-real-session-secret-with-more-than-32-chars",
      MCP_TOKEN: "not-a-real-control-token",
      DISCORD_CLIENT_ID: "123456789012345678",
      DISCORD_CLIENT_SECRET: "a-long-discord-client-secret",
      DASHBOARD_OAUTH_REDIRECT_URI: "http://localhost:3000/auth/discord/callback",
      DASHBOARD_OWNER_IDS: "111111111111111111",
      NODE_ENV: "test",
    });
    const owner = { id: "111111111111111111", name: "Owner", avatarUrl: "https://cdn.discordapp.com/avatars/1/a.png?size=64" };
    const exchange = vi.fn(async (code: string) => {
      if (code === "owner") return owner;
      if (code === "stranger") return { ...owner, id: "222222222222222222" };
      throw new Error("denied");
    });
    const oauth = {
      authorizeUrl: (state: string) => `https://discord.com/oauth2/authorize?state=${state}`,
      exchange,
    };
    const app = createDashboardServer({ config: oauthSettings, publicDir, control: controlStub(), oauth });

    const begin = await app.inject({ method: "GET", url: "/auth/discord" });
    expect(begin.statusCode).toBe(302);
    const beginCookies = Array.isArray(begin.headers["set-cookie"])
      ? begin.headers["set-cookie"].join("; ")
      : String(begin.headers["set-cookie"] ?? "");
    const state = beginCookies.match(/siela_oauth_state=([^;]+)/)?.[1];
    expect(state).toBeTruthy();
    expect(begin.headers.location).toContain(`state=${state}`);

    const badState = await app.inject({ method: "GET", url: "/auth/discord/callback?code=owner&state=wrong" });
    expect(badState.statusCode).toBe(302);
    expect(badState.headers.location).toBe("/?oauth=state");
    expect(exchange).not.toHaveBeenCalled();

    const denied = await app.inject({
      method: "GET",
      url: `/auth/discord/callback?code=stranger&state=${state}`,
      headers: { cookie: `siela_oauth_state=${state}` },
    });
    expect(denied.headers.location).toBe("/?oauth=denied");
    expect(denied.headers["set-cookie"]).not.toContain("siela_dashboard=");

    const success = await app.inject({
      method: "GET",
      url: `/auth/discord/callback?code=owner&state=${state}`,
      headers: { cookie: `siela_oauth_state=${state}` },
    });
    expect(success.statusCode).toBe(302);
    expect(success.headers.location).toBe("/");
    const cookies = Array.isArray(success.headers["set-cookie"])
      ? success.headers["set-cookie"].join("; ")
      : String(success.headers["set-cookie"]);
    const sessionCookie = cookies.match(/siela_dashboard=([^;]+)/)?.[1];
    expect(sessionCookie).toBeTruthy();
    const session = await app.inject({ method: "GET", url: "/api/session", headers: { cookie: `siela_dashboard=${sessionCookie}` } });
    expect(session.json()).toMatchObject({ authenticated: true, oauth: true, password: true, user: { id: owner.id, name: owner.name } });
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
      payload: { password },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain("Secure");
    await app.close();
  });

  it("maps a feature update to the fixed control API route and passes the actor", async () => {
    const control = controlStub();
    const app = createDashboardServer({ config, publicDir, control });
    const response = await app.inject({
      method: "PATCH",
      url: "/api/guilds/123456789/features/music-playback",
      headers: sessionHeaders(owner),
      payload: { enabled: false },
    });

    expect(response.statusCode).toBe(200);
    expect(control.updateFeature).toHaveBeenCalledWith("123456789", "music-playback", false, owner.id);
    await app.close();
  });

  it("reports Administrator permission for the signed-in user", async () => {
    const control = controlStub();
    const app = createDashboardServer({ config, publicDir, control });
    const response = await app.inject({
      method: "GET",
      url: "/api/guilds/123456789/permissions",
      headers: sessionHeaders(owner),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ administrator: true });
    expect(control.authorize).toHaveBeenCalledWith("123456789", owner.id);
    await app.close();
  });

  it("reports no permission when the member is not an administrator or the check fails", async () => {
    const member = controlStub({ authorize: vi.fn().mockResolvedValue({ administrator: false, user: null }) });
    const memberApp = createDashboardServer({ config, publicDir, control: member });
    const memberResponse = await memberApp.inject({
      method: "GET",
      url: "/api/guilds/123456789/permissions",
      headers: sessionHeaders(owner),
    });
    expect(memberResponse.json()).toEqual({ administrator: false });
    await memberApp.close();

    const failing = controlStub({ authorize: vi.fn().mockRejectedValue(new Error("control offline")) });
    const failingApp = createDashboardServer({ config, publicDir, control: failing });
    const failingResponse = await failingApp.inject({
      method: "GET",
      url: "/api/guilds/123456789/permissions",
      headers: sessionHeaders(owner),
    });
    expect(failingResponse.statusCode).toBe(200);
    expect(failingResponse.json()).toEqual({ administrator: false });
    await failingApp.close();
  });

  it("blocks feature and settings writes without Administrator permission", async () => {
    const control = controlStub({ authorize: vi.fn().mockResolvedValue({ administrator: false, user: null }) });
    const app = createDashboardServer({ config, publicDir, control });
    const feature = await app.inject({
      method: "PATCH",
      url: "/api/guilds/123456789/features/music-playback",
      headers: sessionHeaders(owner),
      payload: { enabled: false },
    });
    const settings = await app.inject({
      method: "PATCH",
      url: "/api/guilds/123456789/config/prefix",
      headers: sessionHeaders(owner),
      payload: { prefix: "?" },
    });

    expect(feature.statusCode).toBe(403);
    expect(feature.json().error).toMatchObject({ code: "administrator_required" });
    expect(settings.statusCode).toBe(403);
    expect(settings.json().error).toMatchObject({ code: "administrator_required" });
    expect(control.updateFeature).not.toHaveBeenCalled();
    expect(control.patchConfig).not.toHaveBeenCalled();
    await app.close();
  });

  it("blocks writes when the permission check fails", async () => {
    const control = controlStub({ authorize: vi.fn().mockRejectedValue(new Error("control offline")) });
    const app = createDashboardServer({ config, publicDir, control });
    const response = await app.inject({
      method: "PATCH",
      url: "/api/guilds/123456789/features/music-playback",
      headers: sessionHeaders(owner),
      payload: { enabled: false },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("administrator_required");
    expect(control.updateFeature).not.toHaveBeenCalled();
    await app.close();
  });

  it("passes the signed-in user as actor for a settings write", async () => {
    const control = controlStub();
    const app = createDashboardServer({ config, publicDir, control });
    const response = await app.inject({
      method: "PATCH",
      url: "/api/guilds/123456789/config/prefix",
      headers: sessionHeaders(owner),
      payload: { prefix: "?" },
    });

    expect(response.statusCode).toBe(200);
    expect(control.patchConfig).toHaveBeenCalledWith("123456789", "prefix", { prefix: "?" }, owner.id);
    await app.close();
  });

  it("does not change features without an authenticated Discord user", async () => {
    const control = controlStub();
    const app = createDashboardServer({ config, publicDir, control });
    const response = await app.inject({
      method: "PATCH",
      url: "/api/guilds/123456789/features/music-playback",
      headers: sessionHeaders(),
      payload: { enabled: false },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("administrator_required");
    expect(control.updateFeature).not.toHaveBeenCalled();
    await app.close();
  });

  it("reads, saves, and clears the session user's birthday", async () => {
    const birthday = { month: 4, day: 2, birthYear: null };
    const control = controlStub({ getBirthday: vi.fn().mockResolvedValue(birthday) });
    const app = createDashboardServer({ config, publicDir, control });
    const read = await app.inject({
      method: "GET",
      url: "/api/guilds/123456789/me/birthday",
      headers: sessionHeaders(owner),
    });
    const save = await app.inject({
      method: "PUT",
      url: "/api/guilds/123456789/me/birthday",
      headers: sessionHeaders(owner),
      payload: { month: 4, day: 2 },
    });
    const clear = await app.inject({
      method: "DELETE",
      url: "/api/guilds/123456789/me/birthday",
      headers: sessionHeaders(owner),
    });

    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ birthday });
    expect(control.getBirthday).toHaveBeenCalledWith("123456789", owner.id);
    expect(save.statusCode).toBe(200);
    expect(control.setBirthday).toHaveBeenCalledWith("123456789", owner.id, { month: 4, day: 2 });
    expect(clear.statusCode).toBe(200);
    expect(clear.json()).toEqual({ ok: true });
    expect(control.clearBirthday).toHaveBeenCalledWith("123456789", owner.id);
    await app.close();
  });

  it("returns an empty birthday when the control API has none", async () => {
    const control = controlStub({ getBirthday: vi.fn().mockResolvedValue({ birthday: null }) });
    const app = createDashboardServer({ config, publicDir, control });
    const response = await app.inject({
      method: "GET",
      url: "/api/guilds/123456789/me/birthday",
      headers: sessionHeaders(owner),
    });

    expect(response.json()).toEqual({ birthday: null });
    await app.close();
  });

  it("requires CSRF for a birthday write and a Discord account for birth data", async () => {
    const control = controlStub();
    const app = createDashboardServer({ config, publicDir, control });
    const noCsrf = await app.inject({
      method: "PUT",
      url: "/api/guilds/123456789/me/birthday",
      headers: { cookie: sessionHeaders(owner).cookie },
      payload: { month: 1, day: 1 },
    });
    const operator = await app.inject({
      method: "GET",
      url: "/api/guilds/123456789/me/birthday",
      headers: sessionHeaders({ id: "operator", name: "Operator", avatarUrl: null }),
    });

    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json().error.code).toBe("csrf_mismatch");
    expect(operator.statusCode).toBe(403);
    expect(operator.json().error.code).toBe("discord_account_required");
    expect(control.setBirthday).not.toHaveBeenCalled();
    expect(control.getBirthday).not.toHaveBeenCalled();
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

describe("dashboard game routes", () => {
  it("reads CAH and Tambola state for any signed-in session", async () => {
    const control = controlStub();
    const app = createDashboardServer({ config, publicDir, control });
    const cah = await app.inject({ method: "GET", url: "/api/guilds/123/cah", headers: sessionHeaders() });
    const tambola = await app.inject({ method: "GET", url: "/api/guilds/123/tambola", headers: sessionHeaders() });

    expect(cah.statusCode).toBe(200);
    expect(cah.json()).toEqual({ enabled: true, game: null });
    expect(tambola.statusCode).toBe(200);
    expect(control.cahState).toHaveBeenCalledWith("123");
    expect(control.tambolaState).toHaveBeenCalledWith("123");
    await app.close();
  });

  it("requires a Discord identity and CSRF for game controls", async () => {
    const control = controlStub();
    const app = createDashboardServer({ config, publicDir, control });
    const body = { channelId: "333333333333333333", pointsGoal: 5, maxPlayers: 6 };
    const operator = await app.inject({
      method: "POST",
      url: "/api/guilds/123/cah/host",
      headers: sessionHeaders({ id: "operator", name: "Operator", avatarUrl: null }),
      payload: body,
    });
    const noCsrf = await app.inject({
      method: "POST",
      url: "/api/guilds/123/cah/host",
      headers: { cookie: sessionHeaders(owner).cookie },
      payload: body,
    });
    const casino = await app.inject({
      method: "GET",
      url: "/api/guilds/123/casino",
      headers: sessionHeaders({ id: "operator", name: "Operator", avatarUrl: null }),
    });

    expect(operator.statusCode).toBe(403);
    expect(operator.json().error.code).toBe("discord_account_required");
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json().error.code).toBe("csrf_mismatch");
    expect(casino.statusCode).toBe(403);
    expect(casino.json().error.code).toBe("discord_account_required");
    expect(control.cahHost).not.toHaveBeenCalled();
    expect(control.casinoState).not.toHaveBeenCalled();
    await app.close();
  });

  it("forwards CAH host and round actions with the signed-in user", async () => {
    const control = controlStub();
    const app = createDashboardServer({ config, publicDir, control });
    const headers = sessionHeaders(owner);
    const host = await app.inject({
      method: "POST",
      url: "/api/guilds/123/cah/host",
      headers,
      payload: { channelId: "333333333333333333", pointsGoal: 5, maxPlayers: 6 },
    });
    const reveal = await app.inject({
      method: "POST",
      url: "/api/guilds/123/cah/reveal",
      headers,
      payload: { gameId: "ABC123", roundIndex: 2 },
    });
    const unknown = await app.inject({
      method: "POST",
      url: "/api/guilds/123/cah/pick",
      headers,
      payload: { gameId: "ABC123" },
    });

    expect(host.statusCode).toBe(200);
    expect(control.cahHost).toHaveBeenCalledWith(
      "123",
      { channelId: "333333333333333333", pointsGoal: 5, maxPlayers: 6 },
      owner.id,
    );
    expect(reveal.statusCode).toBe(200);
    expect(control.cahAction).toHaveBeenCalledWith("123", "reveal", { gameId: "ABC123", roundIndex: 2 }, owner.id);
    expect(unknown.statusCode).toBe(404);
    expect(control.cahAction).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("forwards Tambola controls with the signed-in user", async () => {
    const control = controlStub();
    const app = createDashboardServer({ config, publicDir, control });
    const response = await app.inject({
      method: "POST",
      url: "/api/guilds/123/tambola/pause",
      headers: sessionHeaders(owner),
      payload: { gameId: "TMB123" },
    });

    expect(response.statusCode).toBe(200);
    expect(control.tambolaAction).toHaveBeenCalledWith("123", "pause", { gameId: "TMB123" }, owner.id);
    await app.close();
  });

  it("plays casino games for the session user and rejects an invalid bet", async () => {
    const control = controlStub();
    const app = createDashboardServer({ config, publicDir, control });
    const headers = sessionHeaders(owner);
    const flip = await app.inject({
      method: "POST",
      url: "/api/guilds/123/casino/coinflip",
      headers,
      payload: { bet: 50, side: "heads", requestId: "request-1234" },
    });
    const slots = await app.inject({
      method: "POST",
      url: "/api/guilds/123/casino/slots",
      headers,
      payload: { bet: 25, requestId: "request-5678" },
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/api/guilds/123/casino/slots",
      headers,
      payload: { bet: 0, requestId: "request-zero" },
    });

    expect(flip.statusCode).toBe(200);
    expect(control.casinoPlay).toHaveBeenCalledWith(
      "123",
      "coinflip",
      { bet: 50, side: "heads", requestId: "request-1234" },
      owner.id,
    );
    expect(slots.statusCode).toBe(200);
    expect(control.casinoPlay).toHaveBeenCalledWith(
      "123",
      "slots",
      { bet: 25, requestId: "request-5678" },
      owner.id,
    );
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("invalid_body");
    expect(control.casinoPlay).toHaveBeenCalledTimes(2);
    await app.close();
  });
});
