import { describe, expect, it, vi } from "vitest";
import { PermissionsBitField, type Client, type Guild } from "discord.js";
import { ControlServer } from "./server.js";
import type { Services } from "../framework/types.js";
import type { Logger } from "../lib/logger.js";

const GUILD_A = "111111111111111111";
const GUILD_B = "222222222222222222";
const ADMIN_USER = "900000000000000001";
const MEMBER_USER = "900000000000000002";
const UNKNOWN_USER = "900000000000000003";
const TOKEN = "test-token-0123456789abcdef";

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as unknown as Logger;

interface TestMember {
  id: string;
  displayName: string;
  administrator: boolean;
}

function member(entry: TestMember) {
  return {
    id: entry.id,
    displayName: entry.displayName,
    permissions: {
      has: (flag: bigint) => entry.administrator && flag === PermissionsBitField.Flags.Administrator,
    },
  };
}

function guild(id: string, name: string, members: TestMember[]) {
  const cache = new Map(members.map((entry) => [entry.id, member(entry)]));
  const fetch = vi.fn(async (input: unknown) => {
    if (typeof input === "string") {
      const found = cache.get(input);
      if (!found) throw new Error("Unknown Member");
      return found;
    }
    return new Map();
  });
  return {
    id,
    name,
    memberCount: 7,
    ownerId: "999999999999999999",
    joinedTimestamp: 1_710_000_000_000,
    iconURL: () => null,
    members: { cache, fetch },
  } as unknown as Guild;
}

function server(options: {
  multiGuild?: boolean;
  features?: unknown;
  musicEnabled?: boolean;
  members?: TestMember[];
  auditEntries?: unknown[];
} = {}) {
  const guilds = new Map<string, Guild>([
    [GUILD_A, guild(GUILD_A, "Alpha", options.members ?? [])],
    [GUILD_B, guild(GUILD_B, "Beta", [])],
  ]);
  const ids = options.multiGuild ? [GUILD_A, GUILD_B] : [GUILD_A];
  const audits: unknown[] = [];
  const birthdays = new Map<string, Record<string, unknown>>();
  const services = {
    features: options.features ?? {
      list: async () => [{ id: "relics", label: "Relics", category: "Relics", description: "Cards.", defaultEnabled: true, enabled: false, commands: ["relics"], dependsOn: [] }],
      set: async (guildId: string, featureId: string, enabled: boolean) => ({ guildId, featureId, enabled }),
      setMany: async (_guildId: string, updates: Array<{ featureId: string; enabled: boolean }>) => updates,
      isEnabled: async () => options.musicEnabled !== false,
    },
    music: {
      play: async () => ({ added: 1, first: { title: "Song" } }),
      stop: async () => undefined,
      state: () => ({ playing: false, paused: false, volume: 0, loop: "off", position: 0, current: null, upcoming: [] }),
    },
    audit: {
      log: async (entry: unknown) => { audits.push(entry); },
      tail: async (_guildId: string, limit: number) => (options.auditEntries ?? []).slice(0, limit),
    },
    birthday: {
      get: async (guildId: string, userId: string) => birthdays.get(`${guildId}:${userId}`) ?? null,
      set: async (guildId: string, userId: string, month: number, day: number, birthYear?: number | null) => {
        const row = { guildId, userId, month, day, birthYear: birthYear ?? null, lastWishedDate: null };
        birthdays.set(`${guildId}:${userId}`, row);
        return row;
      },
      clear: async (guildId: string, userId: string) => { birthdays.delete(`${guildId}:${userId}`); },
    },
    settings: { ensure: async () => undefined },
    registry: { metadata: () => [] },
  } as unknown as Services;
  const instance = new ControlServer({
    services,
    client: { guilds: { cache: guilds } } as unknown as Client,
    token: TOKEN,
    logger,
    getStatus: async () => ({
      ready: true,
      uptimeSeconds: 1,
      gatewayPing: 20,
      guildId: options.multiGuild ? null : GUILD_A,
      guildCount: ids.length,
      database: "up",
      music: "up",
      activePlayers: 0,
      activeTempVcs: 0,
      version: "test",
    }),
    getDefaultGuildId: () => (options.multiGuild ? null : GUILD_A),
    getGuildIds: () => ids,
  });
  const guildA = guilds.get(GUILD_A) as unknown as { members: { fetch: ReturnType<typeof vi.fn> } };
  return { app: instance.instance, audits, memberFetch: guildA.members.fetch };
}

const auth = { authorization: `Bearer ${TOKEN}` };

describe("ControlServer guild scoping", () => {
  it("rejects a request without the control token", async () => {
    const { app } = server();
    const response = await app.inject({ method: "GET", url: "/v1/status" });
    expect(response.statusCode).toBe(401);
  });

  it("lists every served guild", async () => {
    const { app } = server({ multiGuild: true });
    const response = await app.inject({ method: "GET", url: "/v1/guilds", headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json().guilds.map((entry: { id: string }) => entry.id)).toEqual([GUILD_A, GUILD_B]);
  });

  it("refuses an ambiguous guild on a multi-guild node", async () => {
    const { app } = server({ multiGuild: true });
    const response = await app.inject({ method: "GET", url: "/v1/features", headers: auth });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("guild_required");
  });

  it("accepts an explicit served guild", async () => {
    const { app } = server({ multiGuild: true });
    const response = await app.inject({
      method: "GET",
      url: "/v1/features",
      headers: { ...auth, "x-guild-id": GUILD_B },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().guildId).toBe(GUILD_B);
  });

  it("rejects a guild this node does not serve", async () => {
    const { app } = server({ multiGuild: true });
    const response = await app.inject({
      method: "GET",
      url: "/v1/features",
      headers: { ...auth, "x-guild-id": "333333333333333333" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("unknown_guild");
  });

  it("rejects music controls when the feature is off but allows cleanup", async () => {
    const { app } = server({ musicEnabled: false });
    const play = await app.inject({
      method: "POST",
      url: "/v1/music/play",
      headers: auth,
      payload: { query: "song" },
    });
    expect(play.statusCode).toBe(400);
    expect(play.json().error.code).toBe("feature_disabled");
    const stop = await app.inject({ method: "POST", url: "/v1/music/stop", headers: auth, payload: {} });
    expect(stop.statusCode).toBe(200);
  });

  it("toggles a feature and writes an audit entry", async () => {
    const { app, audits } = server();
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/features",
      headers: { ...auth, "x-actor": "operator" },
      payload: { featureId: "relics", enabled: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ guildId: GUILD_A, featureId: "relics", enabled: true });
    expect(audits).toHaveLength(1);
    expect((audits[0] as { action: string }).action).toBe("features.update");
  });
});

describe("ControlServer authorization", () => {
  it("reports an administrator with the member display name", async () => {
    const { app } = server({ members: [{ id: ADMIN_USER, displayName: "Ada", administrator: true }] });
    const response = await app.inject({
      method: "GET",
      url: "/v1/authorize",
      headers: { ...auth, "x-user-id": ADMIN_USER },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ administrator: true, user: { id: ADMIN_USER, name: "Ada" } });
  });

  it("reports a member without the Administrator permission", async () => {
    const { app } = server({ members: [{ id: MEMBER_USER, displayName: "Grace", administrator: false }] });
    const response = await app.inject({
      method: "GET",
      url: "/v1/authorize",
      headers: { ...auth, "x-user-id": MEMBER_USER },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ administrator: false, user: { id: MEMBER_USER, name: "Grace" } });
  });

  it("returns no user for a user outside the guild", async () => {
    const { app } = server();
    const response = await app.inject({
      method: "GET",
      url: "/v1/authorize",
      headers: { ...auth, "x-user-id": UNKNOWN_USER },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ administrator: false, user: null });
  });

  it("rejects a missing or invalid user ID", async () => {
    const { app } = server();
    const missing = await app.inject({ method: "GET", url: "/v1/authorize", headers: auth });
    const invalid = await app.inject({ method: "GET", url: "/v1/authorize", headers: { ...auth, "x-user-id": "operator" } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe("invalid_user_id");
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("invalid_user_id");
  });
});

describe("ControlServer birthdays", () => {
  it("returns an empty birthday for a user without one", async () => {
    const { app } = server();
    const response = await app.inject({
      method: "GET",
      url: "/v1/users/me/birthday",
      headers: { ...auth, "x-user-id": ADMIN_USER },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ birthday: null });
  });

  it("sets and clears the caller's birthday", async () => {
    const { app } = server();
    const set = await app.inject({
      method: "PUT",
      url: "/v1/users/me/birthday",
      headers: { ...auth, "x-user-id": ADMIN_USER },
      payload: { month: 2, day: 29, year: 2000 },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({ userId: ADMIN_USER, month: 2, day: 29, birthYear: 2000 });

    const get = await app.inject({
      method: "GET",
      url: "/v1/users/me/birthday",
      headers: { ...auth, "x-user-id": ADMIN_USER },
    });
    expect(get.json()).toMatchObject({ userId: ADMIN_USER, month: 2, day: 29 });

    const clear = await app.inject({
      method: "DELETE",
      url: "/v1/users/me/birthday",
      headers: { ...auth, "x-user-id": ADMIN_USER },
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json()).toEqual({ ok: true });

    const after = await app.inject({
      method: "GET",
      url: "/v1/users/me/birthday",
      headers: { ...auth, "x-user-id": ADMIN_USER },
    });
    expect(after.json()).toEqual({ birthday: null });
  });

  it("does not return another user's birthday", async () => {
    const { app } = server();
    await app.inject({
      method: "PUT",
      url: "/v1/users/me/birthday",
      headers: { ...auth, "x-user-id": ADMIN_USER },
      payload: { month: 5, day: 4 },
    });
    const other = await app.inject({
      method: "GET",
      url: "/v1/users/me/birthday",
      headers: { ...auth, "x-user-id": MEMBER_USER },
    });
    expect(other.json()).toEqual({ birthday: null });
  });

  it("rejects an impossible date and an out-of-range year", async () => {
    const { app } = server();
    const dates = [
      { month: 2, day: 30, year: 2000 },
      { month: 2, day: 29, year: 2023 },
      { month: 13, day: 1 },
      { month: 1, day: 1, year: 1899 },
      { month: 1, day: 1, year: new Date().getUTCFullYear() + 1 },
    ];
    for (const payload of dates) {
      const response = await app.inject({
        method: "PUT",
        url: "/v1/users/me/birthday",
        headers: { ...auth, "x-user-id": ADMIN_USER },
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expect(response.json().error.code).toBe("validation_error");
    }
  });
});

describe("ControlServer audit actor names", () => {
  it("resolves a cached actor and keeps an id-like fallback", async () => {
    const { app, memberFetch } = server({
      members: [{ id: ADMIN_USER, displayName: "Ada", administrator: true }],
      auditEntries: [
        { id: "1", actorId: ADMIN_USER, actorType: "user", source: "control", action: "features.update", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "2", actorId: "dashboard", actorType: "mcp", source: "control", action: "features.update", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "3", actorId: null, actorType: "system", source: "system", action: "startup", createdAt: "2026-01-01T00:00:00.000Z" },
      ],
    });
    const response = await app.inject({ method: "GET", url: "/v1/audit", headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json().map((entry: { actorId: string | null; actorName: string | null }) => [entry.actorId, entry.actorName])).toEqual([
      [ADMIN_USER, "Ada"],
      ["dashboard", "dashboard"],
      [null, null],
    ]);
    expect(memberFetch).not.toHaveBeenCalled();
  });

  it("fetches every uncached actor in one batch and falls back to the ID", async () => {
    const { app, memberFetch } = server({
      auditEntries: [
        { id: "1", actorId: UNKNOWN_USER, actorType: "user", source: "control", action: "features.update", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "2", actorId: MEMBER_USER, actorType: "user", source: "control", action: "prefix.set", createdAt: "2026-01-01T00:00:00.000Z" },
      ],
    });
    const response = await app.inject({ method: "GET", url: "/v1/audit", headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json().map((entry: { actorName: string }) => entry.actorName)).toEqual([UNKNOWN_USER, MEMBER_USER]);
    expect(memberFetch).toHaveBeenCalledTimes(1);
    expect(memberFetch).toHaveBeenCalledWith({ user: [UNKNOWN_USER, MEMBER_USER] });
  });
});
