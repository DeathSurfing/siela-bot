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

interface CahStubGame {
  id: string;
  hostId: string;
  judgeId: string | null;
  roundIndex: number | null;
}

interface TambolaStubGame {
  id: string;
  hostId: string;
}

interface EconomyStub {
  getBalance: (guildId: string, userId: string) => Promise<{ balance: number }>;
  spend: (...args: unknown[]) => Promise<unknown>;
  award: (...args: unknown[]) => Promise<unknown>;
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

function guild(id: string, name: string, members: TestMember[], channel?: { id: string; guildId: string; isTextBased: () => boolean }) {
  const cache = new Map(members.map((entry) => [entry.id, member(entry)]));
  const fetch = vi.fn(async (input: unknown) => {
    if (typeof input === "string") {
      const found = cache.get(input);
      if (!found) throw new Error("Unknown Member");
      return found;
    }
    return new Map();
  });
  const channelsFetch = vi.fn(async (channelId: string) => channel ? { ...channel, id: channelId } : null);
  return {
    id,
    name,
    memberCount: 7,
    ownerId: "999999999999999999",
    joinedTimestamp: 1_710_000_000_000,
    iconURL: () => null,
    members: { cache, fetch },
    channels: { cache: new Map(), fetch: channelsFetch },
  } as unknown as Guild;
}

function server(options: {
  multiGuild?: boolean;
  features?: unknown;
  musicEnabled?: boolean;
  cahEnabled?: boolean;
  tambolaEnabled?: boolean;
  economyEnabled?: boolean;
  members?: TestMember[];
  auditEntries?: unknown[];
  channel?: { id: string; guildId: string; isTextBased: () => boolean };
  cahGame?: CahStubGame | null;
  cahLast?: CahStubGame | null;
  tambolaGame?: TambolaStubGame | null;
  economy?: EconomyStub;
} = {}) {
  const guilds = new Map<string, Guild>([
    [GUILD_A, guild(GUILD_A, "Alpha", options.members ?? [], options.channel)],
    [GUILD_B, guild(GUILD_B, "Beta", [])],
  ]);
  const ids = options.multiGuild ? [GUILD_A, GUILD_B] : [GUILD_A];
  const audits: unknown[] = [];
  const birthdays = new Map<string, Record<string, unknown>>();
  const economy = options.economy ?? {
    getBalance: vi.fn(async () => ({ balance: 500 })),
    spend: vi.fn(async () => undefined),
    award: vi.fn(async () => ({ amount: 0, duplicate: false })),
  };
  const cah = {
    snapshot: vi.fn(() => options.cahGame ?? null),
    lastResult: vi.fn(() => options.cahLast ?? null),
    host: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
    reveal: vi.fn(async () => undefined),
    next: vi.fn(async () => undefined),
    end: vi.fn(async () => undefined),
  };
  const tambola = {
    snapshot: vi.fn(() => options.tambolaGame ?? null),
    end: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
  };
  const featuresStub = options.features ?? {
    list: async () => [{ id: "relics", label: "Relics", category: "Relics", description: "Cards.", defaultEnabled: true, enabled: false, commands: ["relics"], dependsOn: [] }],
    set: async (guildId: string, featureId: string, enabled: boolean) => ({ guildId, featureId, enabled }),
    setMany: async (_guildId: string, updates: Array<{ featureId: string; enabled: boolean }>) => updates,
    isEnabled: async (_guildId: string, featureId: string) => {
      if (featureId === "music-playback") return options.musicEnabled !== false;
      if (featureId === "games-cah") return options.cahEnabled !== false;
      if (featureId === "games-tambola") return options.tambolaEnabled !== false;
      if (featureId === "economy-core") return options.economyEnabled !== false;
      return true;
    },
  };
  const services = {
    features: featuresStub,
    cah,
    tambola,
    economy,
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
  const guildA = guilds.get(GUILD_A) as unknown as {
    members: { fetch: ReturnType<typeof vi.fn> };
    channels: { fetch: ReturnType<typeof vi.fn> };
  };
  return { app: instance.instance, audits, memberFetch: guildA.members.fetch, channelFetch: guildA.channels.fetch, cah, tambola, economy };
}

const auth = { authorization: `Bearer ${TOKEN}` };
const asUser = (id: string) => ({ ...auth, "x-user-id": id });

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

describe("ControlServer game tabs", () => {
  const cahGame = { id: "ABC123", hostId: MEMBER_USER, judgeId: ADMIN_USER, roundIndex: 2 };
  const OTHER_USER = "900000000000000004";
  const members = [
    { id: ADMIN_USER, displayName: "Ada", administrator: true },
    { id: MEMBER_USER, displayName: "Grace", administrator: false },
    { id: OTHER_USER, displayName: "Linus", administrator: false },
  ];

  it("reports the CAH feature flag and the redacted state", async () => {
    const { app } = server({ cahGame, cahEnabled: false });
    const state = await app.inject({ method: "GET", url: "/v1/cah/state", headers: auth });
    expect(state.statusCode).toBe(200);
    expect(state.json()).toMatchObject({ enabled: false, game: { id: "ABC123", hostId: MEMBER_USER } });
  });

  it("creates a CAH lobby from a text channel in the guild", async () => {
    const { app, cah } = server({
      members,
      channel: { id: "333333333333333333", guildId: GUILD_A, isTextBased: () => true },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/cah/host",
      headers: asUser(MEMBER_USER),
      payload: { channelId: "333333333333333333", pointsGoal: 5, maxPlayers: 6 },
    });
    expect(response.statusCode).toBe(200);
    expect(cah.host).toHaveBeenCalledWith(expect.objectContaining({
      guild: expect.objectContaining({ id: GUILD_A }),
      host: expect.objectContaining({ id: MEMBER_USER }),
      pointsGoal: 5,
      maxPlayers: 6,
    }));
  });

  it("refuses a CAH lobby when the feature is off or the channel is elsewhere", async () => {
    const off = server({ members, cahEnabled: false, channel: { id: "333333333333333333", guildId: GUILD_A, isTextBased: () => true } });
    const blocked = await off.app.inject({
      method: "POST",
      url: "/v1/cah/host",
      headers: asUser(MEMBER_USER),
      payload: { channelId: "333333333333333333" },
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error.code).toBe("feature_disabled");
    expect(off.cah.host).not.toHaveBeenCalled();

    const otherGuild = server({ members, channel: { id: "333333333333333333", guildId: GUILD_B, isTextBased: () => true } });
    const invalid = await otherGuild.app.inject({
      method: "POST",
      url: "/v1/cah/host",
      headers: asUser(MEMBER_USER),
      payload: { channelId: "333333333333333333" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("invalid_channel");
  });

  it("lets only the host start a CAH game", async () => {
    const { app, cah } = server({ members, cahGame });
    const denied = await app.inject({
      method: "POST",
      url: "/v1/cah/start",
      headers: asUser(ADMIN_USER),
      payload: { gameId: "ABC123" },
    });
    expect(denied.statusCode).toBe(400);
    expect(denied.json().error.code).toBe("not_host");
    expect(cah.start).not.toHaveBeenCalled();

    const allowed = await app.inject({
      method: "POST",
      url: "/v1/cah/start",
      headers: asUser(MEMBER_USER),
      payload: { gameId: "ABC123" },
    });
    expect(allowed.statusCode).toBe(200);
    expect(cah.start).toHaveBeenCalled();
  });

  it("lets the host or judge reveal and advance, and nobody else", async () => {
    const { app, cah } = server({ members, cahGame });
    const reveal = await app.inject({
      method: "POST",
      url: "/v1/cah/reveal",
      headers: asUser(ADMIN_USER),
      payload: { gameId: "ABC123", roundIndex: 2 },
    });
    expect(reveal.statusCode).toBe(200);
    expect(cah.reveal).toHaveBeenCalled();

    const next = await app.inject({
      method: "POST",
      url: "/v1/cah/next",
      headers: asUser(MEMBER_USER),
      payload: { gameId: "ABC123", roundIndex: 2 },
    });
    expect(next.statusCode).toBe(200);
    expect(cah.next).toHaveBeenCalled();

    const stranger = await app.inject({
      method: "POST",
      url: "/v1/cah/reveal",
      headers: asUser(OTHER_USER),
      payload: { gameId: "ABC123", roundIndex: 2 },
    });
    expect(stranger.statusCode).toBe(400);
    expect(stranger.json().error.code).toBe("not_controller");
  });

  it("lets the host or an administrator end a CAH game", async () => {
    const { app, cah } = server({ members, cahGame });
    const admin = await app.inject({
      method: "POST",
      url: "/v1/cah/end",
      headers: asUser(ADMIN_USER),
      payload: { gameId: "ABC123" },
    });
    expect(admin.statusCode).toBe(200);
    expect(cah.end).toHaveBeenCalled();

    const other = server({ members, cahGame });
    const denied = await other.app.inject({
      method: "POST",
      url: "/v1/cah/end",
      headers: asUser(OTHER_USER),
      payload: { gameId: "ABC123" },
    });
    expect(denied.statusCode).toBe(400);
    expect(denied.json().error.code).toBe("not_controller");
  });

  it("rejects a stale CAH game or round", async () => {
    const { app } = server({ members, cahGame });
    const staleGame = await app.inject({
      method: "POST",
      url: "/v1/cah/end",
      headers: asUser(MEMBER_USER),
      payload: { gameId: "OLD999" },
    });
    expect(staleGame.json().error.code).toBe("stale_game");

    const staleRound = await app.inject({
      method: "POST",
      url: "/v1/cah/next",
      headers: asUser(MEMBER_USER),
      payload: { gameId: "ABC123", roundIndex: 1 },
    });
    expect(staleRound.json().error.code).toBe("stale_round");
  });

  it("reports Tambola state and lets the host or an administrator pause, resume, and end", async () => {
    const tambolaGame = { id: "TMB123", hostId: MEMBER_USER };
    const { app, tambola } = server({ members, tambolaGame });
    const state = await app.inject({ method: "GET", url: "/v1/tambola/state", headers: auth });
    expect(state.json()).toMatchObject({ enabled: true, game: { id: "TMB123" } });

    const off = server({ tambolaEnabled: false });
    const offState = await off.app.inject({ method: "GET", url: "/v1/tambola/state", headers: auth });
    expect(offState.json()).toEqual({ enabled: false, game: null });

    for (const [action, spy] of [["pause", tambola.pause], ["resume", tambola.resume], ["end", tambola.end]] as const) {
      const admin = await app.inject({
        method: "POST",
        url: `/v1/tambola/${action}`,
        headers: asUser(ADMIN_USER),
        payload: { gameId: "TMB123" },
      });
      expect(admin.statusCode).toBe(200);
      expect(spy).toHaveBeenCalled();
    }

    const denied = await app.inject({
      method: "POST",
      url: "/v1/tambola/end",
      headers: asUser(OTHER_USER),
      payload: { gameId: "TMB123" },
    });
    expect(denied.statusCode).toBe(400);
    expect(denied.json().error.code).toBe("not_controller");
  });

  it("returns a casino balance for the caller in the header", async () => {
    const { app, economy } = server({ members });
    const state = await app.inject({ method: "GET", url: "/v1/casino/state", headers: asUser(MEMBER_USER) });
    expect(state.json()).toEqual({ enabled: true, balance: 500, maxBet: 10_000 });
    expect(economy.getBalance).toHaveBeenCalledWith(GUILD_A, MEMBER_USER);

    const missing = await app.inject({ method: "GET", url: "/v1/casino/state", headers: auth });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe("invalid_user_id");
  });

  it("plays coinflip and slots for the header user and rejects an oversized bet", async () => {
    const { app, economy } = server({ members });
    const flip = await app.inject({
      method: "POST",
      url: "/v1/casino/coinflip",
      headers: asUser(MEMBER_USER),
      payload: { bet: 50, side: "heads", requestId: "request-1234" },
    });
    expect(flip.statusCode).toBe(200);
    expect(flip.json()).toMatchObject({ enabled: true, maxBet: 10_000, bet: 50, game: "coinflip" });
    expect(economy.spend).toHaveBeenCalledWith(GUILD_A, MEMBER_USER, 50, "coinflip", expect.stringContaining("request-1234"));

    const slots = await app.inject({
      method: "POST",
      url: "/v1/casino/slots",
      headers: asUser(MEMBER_USER),
      payload: { bet: 25, requestId: "request-5678" },
    });
    expect(slots.statusCode).toBe(200);
    expect(slots.json().game).toBe("slots");

    const oversized = await app.inject({
      method: "POST",
      url: "/v1/casino/coinflip",
      headers: asUser(MEMBER_USER),
      payload: { bet: 10_001, side: "heads", requestId: "request-big" },
    });
    expect(oversized.statusCode).toBe(400);
    expect(oversized.json().error.code).toBe("validation_error");

    const spoofed = await app.inject({
      method: "POST",
      url: "/v1/casino/coinflip",
      headers: asUser(MEMBER_USER),
      payload: { bet: 50, side: "heads", requestId: "request-spoof", userId: ADMIN_USER },
    });
    expect(spoofed.statusCode).toBe(400);
    expect(spoofed.json().error.code).toBe("validation_error");
    expect(economy.spend).toHaveBeenCalledTimes(2);
  });

  it("refuses casino play when the economy feature is off", async () => {
    const { app, economy } = server({ members, economyEnabled: false });
    const response = await app.inject({
      method: "POST",
      url: "/v1/casino/slots",
      headers: asUser(MEMBER_USER),
      payload: { bet: 10, requestId: "request-off" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("feature_disabled");
    expect(economy.spend).not.toHaveBeenCalled();
  });
});
