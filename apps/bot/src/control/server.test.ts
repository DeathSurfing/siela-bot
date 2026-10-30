import { describe, expect, it, vi } from "vitest";
import { ChannelType, PermissionsBitField, type Client, type Guild } from "discord.js";
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
  bot?: boolean;
  voiceChannelId?: string;
}

interface TestChannel {
  id: string;
  name: string;
  type: ChannelType;
  text?: boolean;
}

interface TestRole {
  id: string;
  name: string;
}

interface ScheduledTestEvent {
  id: number;
  name: string;
  channelId: string;
  sourceUrl: string;
  repeat: "none" | "daily" | "weekly";
  enabled: boolean;
  startAt: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: "running" | "success" | "failed" | "skipped" | null;
  lastError: string | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
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
  getBalance: (guildId: string, userId: string) => Promise<{
    balance: number;
    lastDailyAt: Date | null;
    lastWorkAt: Date | null;
    dailyStreak: number;
    totalEarned: number;
    totalSpent: number;
  }>;
  getRank: (guildId: string, userId: string) => Promise<number>;
  leaderboard: (guildId: string, limit: number) => Promise<Array<{ userId: string; balance: number }>>;
  daily: (guildId: string, userId: string) => Promise<{ amount: number; streak: number; nextAt: Date }>;
  work: (guildId: string, userId: string) => Promise<{ amount: number; nextAt: Date }>;
  getMarket: (guildId: string) => Promise<Record<string, unknown>>;
  getPortfolio: (guildId: string, userId: string) => Promise<Record<string, unknown>>;
  buyStock: (guildId: string, userId: string, symbol: string, shares: number) => Promise<Record<string, unknown>>;
  sellStock: (guildId: string, userId: string, symbol: string, shares: number) => Promise<Record<string, unknown>>;
  spend: (...args: unknown[]) => Promise<unknown>;
  award: (...args: unknown[]) => Promise<unknown>;
}

function member(entry: TestMember) {
  return {
    id: entry.id,
    displayName: entry.displayName,
    user: { bot: entry.bot ?? false },
    voice: { channelId: entry.voiceChannelId ?? null },
    permissions: {
      has: (flag: bigint) => entry.administrator && flag === PermissionsBitField.Flags.Administrator,
    },
  };
}

function guild(
  id: string,
  name: string,
  members: TestMember[],
  channel?: { id: string; guildId: string; isTextBased: () => boolean },
  options: { channels?: TestChannel[]; roles?: TestRole[]; search?: TestMember[] } = {},
) {
  const cache = new Map(members.map((entry) => [entry.id, member(entry)]));
  const search = new Map((options.search ?? []).map((entry) => [entry.id, member(entry)]));
  const fetch = vi.fn(async (input: unknown) => {
    if (typeof input === "string") {
      const found = cache.get(input);
      if (!found) throw new Error("Unknown Member");
      return found;
    }
    return search;
  });
  const channelCache = new Map((options.channels ?? []).map((entry) => [entry.id, {
    id: entry.id,
    name: entry.name,
    type: entry.type,
    guildId: id,
    isTextBased: () => entry.text ?? false,
  }]));
  const channelsFetch = vi.fn(async (channelId: string) => channelCache.get(channelId) ?? (channel ? { ...channel, id: channelId } : null));
  const roleCache = new Map((options.roles ?? []).map((entry) => [entry.id, { id: entry.id, name: entry.name }]));
  return {
    id,
    name,
    memberCount: 7,
    ownerId: "999999999999999999",
    joinedTimestamp: 1_710_000_000_000,
    iconURL: () => null,
    members: { cache, fetch },
    roles: { cache: roleCache },
    channels: { cache: channelCache, fetch: channelsFetch },
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
  channels?: TestChannel[];
  roles?: TestRole[];
  search?: TestMember[];
  musicState?: Record<string, unknown>;
  auditEntries?: unknown[];
  channel?: { id: string; guildId: string; isTextBased: () => boolean };
  cahGame?: CahStubGame | null;
  cahLast?: CahStubGame | null;
  tambolaGame?: TambolaStubGame | null;
  economy?: EconomyStub;
  scheduledEventsEnabled?: boolean;
} = {}) {
  const guilds = new Map<string, Guild>([
    [GUILD_A, guild(GUILD_A, "Alpha", options.members ?? [], options.channel, options)],
    [GUILD_B, guild(GUILD_B, "Beta", [])],
  ]);
  const ids = options.multiGuild ? [GUILD_A, GUILD_B] : [GUILD_A];
  const audits: unknown[] = [];
  const birthdays = new Map<string, Record<string, unknown>>();
  const economy = options.economy ?? {
    getBalance: vi.fn(async () => ({ balance: 500, lastDailyAt: null, lastWorkAt: null, dailyStreak: 0, totalEarned: 0, totalSpent: 0 })),
    getRank: vi.fn(async () => 1),
    leaderboard: vi.fn(async () => []),
    daily: vi.fn(async () => ({ amount: 10, streak: 1, nextAt: new Date("2026-10-31T00:00:00.000Z") })),
    work: vi.fn(async () => ({ amount: 5, nextAt: new Date("2026-10-30T10:00:00.000Z") })),
    getMarket: vi.fn(async () => ({ stocks: [], index: 100, indexChange: 0 })),
    getPortfolio: vi.fn(async () => ({ cash: 500, holdings: [], holdingsValue: 0, netWorth: 500, unrealized: 0 })),
    buyStock: vi.fn(async (_guildId: string, _userId: string, symbol: string, shares: number) => ({ symbol, shares, price: 100, fee: 1, total: 101, balance: 399 })),
    sellStock: vi.fn(async (_guildId: string, _userId: string, symbol: string, shares: number) => ({ symbol, shares, price: 100, fee: 1, proceeds: 99, pnl: 0, balance: 599 })),
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
      if (featureId === "automation-scheduled-events") return options.scheduledEventsEnabled !== false;
      return true;
    },
  };
  const music = {
    play: vi.fn(async () => ({ added: 1, first: { title: "Song" } })),
    join: vi.fn(async (joined: { voice?: { channelId?: string | null } }, channelId?: string) => channelId ?? joined.voice?.channelId ?? "unknown"),
    stop: vi.fn(async () => undefined),
    state: vi.fn(() => options.musicState ?? {
      playing: false,
      paused: false,
      volume: 0,
      loop: "off",
      position: 0,
      current: null,
      upcoming: [],
      channelId: null,
      channelName: null,
      filter: "off",
    }),
  };
  const scheduledEventRows = new Map<number, ScheduledTestEvent>();
  let nextScheduledEventId = 1;
  const scheduledEvents = {
    schedulerEnabled: true,
    builtInPhases: vi.fn(() => [{ key: "azan", channelName: "masjid", source: "azan", youtube: false, offsetMs: 0 }]),
    list: vi.fn(async () => [...scheduledEventRows.values()]),
    listRuns: vi.fn(async () => []),
    create: vi.fn(async (_guildId: string, input: {
      name: string;
      channelId: string;
      sourceUrl: string;
      startAt: Date;
      repeat: "none" | "daily" | "weekly";
      enabled: boolean;
    }) => {
      const now = new Date().toISOString();
      const event: ScheduledTestEvent = {
        id: nextScheduledEventId++,
        ...input,
        startAt: input.startAt.toISOString(),
        nextRunAt: input.startAt.toISOString(),
        lastRunAt: null,
        lastStatus: null,
        lastError: null,
        runCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      scheduledEventRows.set(event.id, event);
      return event;
    }),
    update: vi.fn(async (_guildId: string, id: number, input: Partial<{
      name: string;
      channelId: string;
      sourceUrl: string;
      startAt: Date;
      repeat: "none" | "daily" | "weekly";
      enabled: boolean;
    }>) => {
      const current = scheduledEventRows.get(id);
      if (!current) throw new Error("Scheduled event was not found.");
      const event: ScheduledTestEvent = {
        ...current,
        ...input,
        startAt: input.startAt?.toISOString() ?? current.startAt,
        updatedAt: new Date().toISOString(),
      };
      scheduledEventRows.set(id, event);
      return event;
    }),
    remove: vi.fn(async (_guildId: string, id: number) => {
      const event = scheduledEventRows.get(id);
      if (!event) throw new Error("Scheduled event was not found.");
      scheduledEventRows.delete(id);
      return event;
    }),
    runNow: vi.fn(async (_guildId: string, id: number, triggeredBy: string) => ({
      id: 1,
      eventName: scheduledEventRows.get(id)?.name ?? "Event",
      status: "success" as const,
      triggeredBy,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      error: null,
    })),
    startNow: vi.fn(async (_guildId: string, id: number, triggeredBy: string) => ({
      id: 1,
      eventName: scheduledEventRows.get(id)?.name ?? "Event",
      status: "running" as const,
      triggeredBy,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
    })),
  };
  const services = {
    features: featuresStub,
    cah,
    tambola,
    economy,
    music,
    scheduledEvents,
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
  return { app: instance.instance, audits, memberFetch: guildA.members.fetch, channelFetch: guildA.channels.fetch, cah, tambola, economy, music, scheduledEvents };
}

const auth = { authorization: `Bearer ${TOKEN}` };
const asUser = (id: string) => ({ ...auth, "x-user-id": id, "x-guild-id": GUILD_A });

function economyStub(overrides: Partial<EconomyStub> = {}): EconomyStub {
  return {
    getBalance: vi.fn(async () => ({
      balance: 500,
      lastDailyAt: null,
      lastWorkAt: null,
      dailyStreak: 0,
      totalEarned: 0,
      totalSpent: 0,
    })),
    getRank: vi.fn(async () => 1),
    leaderboard: vi.fn(async () => []),
    daily: vi.fn(async () => ({ amount: 10, streak: 1, nextAt: new Date("2026-10-31T00:00:00.000Z") })),
    work: vi.fn(async () => ({ amount: 5, nextAt: new Date("2026-10-30T10:00:00.000Z") })),
    getMarket: vi.fn(async () => ({ stocks: [], index: 100, indexChange: 0 })),
    getPortfolio: vi.fn(async () => ({ cash: 500, holdings: [], holdingsValue: 0, netWorth: 500, unrealized: 0 })),
    buyStock: vi.fn(async (_guildId: string, _userId: string, symbol: string, shares: number) => ({ symbol, shares, price: 100, fee: 1, total: 101, balance: 399 })),
    sellStock: vi.fn(async (_guildId: string, _userId: string, symbol: string, shares: number) => ({ symbol, shares, price: 100, fee: 1, proceeds: 99, pnl: 0, balance: 599 })),
    spend: vi.fn(async () => undefined),
    award: vi.fn(async () => ({ amount: 0, duplicate: false })),
    ...overrides,
  };
}

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

describe("ControlServer name resolution", () => {
  const channels: TestChannel[] = [
    { id: "333333333333333301", name: "General", type: ChannelType.GuildText, text: true },
    { id: "333333333333333302", name: "General Chat", type: ChannelType.GuildText, text: true },
    { id: "333333333333333303", name: "Chatty General", type: ChannelType.GuildText, text: true },
    { id: "333333333333333304", name: "General Voice", type: ChannelType.GuildVoice },
    { id: "333333333333333305", name: "General", type: ChannelType.GuildCategory },
  ];
  const roles: TestRole[] = [
    { id: GUILD_A, name: "@everyone" },
    { id: "333333333333333306", name: "General" },
  ];
  const members: TestMember[] = [
    { id: ADMIN_USER, displayName: "Ada", administrator: true },
    { id: MEMBER_USER, displayName: "Adam", administrator: false },
    { id: "900000000000000004", displayName: "Botty", administrator: false, bot: true },
  ];

  it("ranks an exact channel name, then a prefix, then a substring", async () => {
    const { app } = server({ channels });
    const response = await app.inject({ method: "GET", url: "/v1/resolve?q=general&kind=channel", headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json().results.map((entry: { id: string }) => entry.id)).toEqual([
      "333333333333333301",
      "333333333333333305",
      "333333333333333302",
      "333333333333333303",
    ]);
    expect(response.json().results[0]).toEqual({
      id: "333333333333333301",
      name: "General",
      kind: "channel",
      label: "#General",
    });
    expect(response.json().results[1].description).toBe("Category");
  });

  it("returns only voice channels for the voice kind", async () => {
    const { app } = server({ channels });
    const response = await app.inject({ method: "GET", url: "/v1/resolve?q=general&kind=voice", headers: auth });
    expect(response.json().results).toEqual([
      { id: "333333333333333304", name: "General Voice", kind: "voice", label: "#General Voice" },
    ]);
  });

  it("resolves roles and marks the everyone role", async () => {
    const { app } = server({ roles });
    const exact = await app.inject({ method: "GET", url: "/v1/resolve?q=general&kind=role", headers: auth });
    const everyone = await app.inject({ method: "GET", url: "/v1/resolve?q=everyone&kind=role", headers: auth });
    expect(exact.json().results[0]).toEqual({
      id: "333333333333333306",
      name: "General",
      kind: "role",
      label: "@General",
    });
    expect(everyone.json().results[0]).toMatchObject({ label: "@everyone", description: "Includes every member" });
  });

  it("resolves cached members, marks bots, and searches the gateway when the cache misses", async () => {
    const { app } = server({
      members,
      search: [{ id: "900000000000000005", displayName: "Fetched Friend", administrator: false }],
    });
    const response = await app.inject({ method: "GET", url: "/v1/resolve?q=ada&kind=user", headers: auth });
    const bot = await app.inject({ method: "GET", url: "/v1/resolve?q=botty&kind=user", headers: auth });
    const fetched = await app.inject({ method: "GET", url: "/v1/resolve?q=fetched&kind=user", headers: auth });
    expect(response.json().results.map((entry: { id: string }) => entry.id)).toEqual([ADMIN_USER, MEMBER_USER]);
    expect(bot.json().results[0]).toMatchObject({ id: "900000000000000004", description: "Bot" });
    expect(fetched.json().results[0]).toMatchObject({ id: "900000000000000005", label: "Fetched Friend" });
  });

  it("strips a leading # or @ from the search text", async () => {
    const { app } = server({ channels, members });
    const channel = await app.inject({ method: "GET", url: "/v1/resolve?q=%23general&kind=channel", headers: auth });
    const user = await app.inject({ method: "GET", url: "/v1/resolve?q=%40ada&kind=user", headers: auth });
    expect(channel.json().results[0].id).toBe("333333333333333301");
    expect(user.json().results[0].id).toBe(ADMIN_USER);
  });

  it("caps the result list at the requested limit", async () => {
    const { app } = server({ channels });
    const response = await app.inject({ method: "GET", url: "/v1/resolve?q=general&kind=channel&limit=2", headers: auth });
    expect(response.json().results).toHaveLength(2);
  });

  it("never resolves names from another guild", async () => {
    const { app } = server({ multiGuild: true, channels });
    const response = await app.inject({
      method: "GET",
      url: "/v1/resolve?q=general&kind=channel",
      headers: { ...auth, "x-guild-id": GUILD_B },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().results).toEqual([]);
  });

  it("rejects an empty query and an unknown kind", async () => {
    const { app } = server();
    const empty = await app.inject({ method: "GET", url: "/v1/resolve?q=%20", headers: auth });
    const kind = await app.inject({ method: "GET", url: "/v1/resolve?q=general&kind=server", headers: auth });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.code).toBe("validation_error");
    expect(kind.statusCode).toBe(400);
  });
});

describe("ControlServer economy member routes", () => {
  it("returns the caller's balance, streak, totals, and ready times", async () => {
    const lastDaily = new Date(Date.now() - 60_000);
    const economy = economyStub({
      getBalance: vi.fn(async () => ({
        balance: 750,
        lastDailyAt: lastDaily,
        lastWorkAt: null,
        dailyStreak: 4,
        totalEarned: 900,
        totalSpent: 150,
      })),
    });
    const { app } = server({ economy, members: [{ id: MEMBER_USER, displayName: "Grace", administrator: false }] });
    const response = await app.inject({ method: "GET", url: "/v1/economy/state", headers: asUser(MEMBER_USER) });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      enabled: true,
      balance: 750,
      dailyStreak: 4,
      lastDailyAt: lastDaily.toISOString(),
      lastWorkAt: null,
      dailyReadyAt: new Date(lastDaily.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      workReadyAt: null,
      totalEarned: 900,
      totalSpent: 150,
    });
    expect(economy.getBalance).toHaveBeenCalledWith(GUILD_A, MEMBER_USER);
  });

  it("gates state, daily, and work on the economy feature", async () => {
    const { app } = server({ economyEnabled: false });
    const state = await app.inject({ method: "GET", url: "/v1/economy/state", headers: asUser(MEMBER_USER) });
    const daily = await app.inject({ method: "POST", url: "/v1/economy/daily", headers: asUser(MEMBER_USER), payload: {} });
    const work = await app.inject({ method: "POST", url: "/v1/economy/work", headers: asUser(MEMBER_USER), payload: {} });

    expect(state.json()).toEqual({ enabled: false });
    expect(daily.statusCode).toBe(400);
    expect(daily.json().error.code).toBe("feature_disabled");
    expect(work.statusCode).toBe(400);
    expect(work.json().error.code).toBe("feature_disabled");
  });

  it("claims daily and work for the header user, never a body user", async () => {
    const economy = economyStub();
    const { app } = server({ economy });
    const daily = await app.inject({
      method: "POST",
      url: "/v1/economy/daily",
      headers: asUser(MEMBER_USER),
      payload: { userId: ADMIN_USER },
    });
    const work = await app.inject({
      method: "POST",
      url: "/v1/economy/work",
      headers: asUser(MEMBER_USER),
      payload: { userId: ADMIN_USER },
    });

    expect(daily.statusCode).toBe(200);
    expect(daily.json()).toEqual({
      amount: 10,
      streak: 1,
      nextAt: "2026-10-31T00:00:00.000Z",
      balance: 500,
    });
    expect(work.statusCode).toBe(200);
    expect(work.json()).toEqual({ amount: 5, nextAt: "2026-10-30T10:00:00.000Z", balance: 500 });
    expect(economy.daily).toHaveBeenCalledWith(GUILD_A, MEMBER_USER);
    expect(economy.work).toHaveBeenCalledWith(GUILD_A, MEMBER_USER);
    expect(economy.daily).not.toHaveBeenCalledWith(GUILD_A, ADMIN_USER);
  });

  it("maps cooldown errors to a message with the ready time", async () => {
    const economy = economyStub({
      daily: vi.fn(async () => { throw new Error("DAILY_COOLDOWN:2026-10-31T07:00:00.000Z"); }),
      work: vi.fn(async () => { throw new Error("WORK_COOLDOWN:2026-10-30T09:30:00.000Z"); }),
    });
    const { app } = server({ economy });
    const daily = await app.inject({ method: "POST", url: "/v1/economy/daily", headers: asUser(MEMBER_USER), payload: {} });
    const work = await app.inject({ method: "POST", url: "/v1/economy/work", headers: asUser(MEMBER_USER), payload: {} });

    expect(daily.statusCode).toBe(400);
    expect(daily.json().error.code).toBe("daily_cooldown");
    expect(daily.json().error.message).toMatch(/Try again at .*2026/);
    expect(work.statusCode).toBe(400);
    expect(work.json().error.code).toBe("work_cooldown");
    expect(work.json().error.message).toMatch(/Try again at .*2026/);
  });

  it("assembles leaderboard names, rank, and a fallback for an unknown member", async () => {
    const economy = economyStub({
      getBalance: vi.fn(async () => ({
        balance: 500,
        lastDailyAt: null,
        lastWorkAt: null,
        dailyStreak: 0,
        totalEarned: 0,
        totalSpent: 0,
      })),
      getRank: vi.fn(async () => 2),
      leaderboard: vi.fn(async () => [
        { userId: MEMBER_USER, balance: 900 },
        { userId: ADMIN_USER, balance: 500 },
        { userId: UNKNOWN_USER, balance: 100 },
      ]),
    });
    const { app, memberFetch } = server({
      economy,
      members: [
        { id: MEMBER_USER, displayName: "Grace", administrator: false },
        { id: ADMIN_USER, displayName: "Ada", administrator: true },
      ],
    });
    const response = await app.inject({ method: "GET", url: "/v1/economy/leaderboard?limit=25", headers: asUser(MEMBER_USER) });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      enabled: true,
      entries: [
        { rank: 1, userId: MEMBER_USER, name: "Grace", balance: 900 },
        { rank: 2, userId: ADMIN_USER, name: "Ada", balance: 500 },
        { rank: 3, userId: UNKNOWN_USER, name: UNKNOWN_USER, balance: 100 },
      ],
      me: { rank: 2, balance: 500 },
    });
    expect(economy.leaderboard).toHaveBeenCalledWith(GUILD_A, 25);
    expect(memberFetch).toHaveBeenCalledWith({ user: [UNKNOWN_USER] });
  });

  it("returns an empty leaderboard when the economy is off", async () => {
    const { app } = server({ economyEnabled: false });
    const response = await app.inject({ method: "GET", url: "/v1/economy/leaderboard", headers: asUser(MEMBER_USER) });
    expect(response.json()).toEqual({ enabled: false, entries: [], me: null });
  });

  it("rejects a leaderboard limit outside 1 to 50", async () => {
    const { app } = server();
    const response = await app.inject({ method: "GET", url: "/v1/economy/leaderboard?limit=0", headers: asUser(MEMBER_USER) });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("validation_error");
  });
});

describe("ControlServer stock member routes", () => {
  const market = { stocks: [{ symbol: "SIELA", name: "Siela Coin", price: 120, history: [100, 120] }], index: 110, indexChange: 2.5 };
  const portfolio = { cash: 400, holdings: [], holdingsValue: 0, netWorth: 400, unrealized: 0 };

  it("returns the market and the caller's portfolio", async () => {
    const economy = economyStub({
      getMarket: vi.fn(async () => market),
      getPortfolio: vi.fn(async () => portfolio),
    });
    const { app } = server({ economy });
    const response = await app.inject({ method: "GET", url: "/v1/stocks/state", headers: asUser(MEMBER_USER) });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ enabled: true, market, portfolio });
    expect(economy.getPortfolio).toHaveBeenCalledWith(GUILD_A, MEMBER_USER);
  });

  it("gates the stock view and trades on the economy feature", async () => {
    const { app } = server({ economyEnabled: false });
    const state = await app.inject({ method: "GET", url: "/v1/stocks/state", headers: asUser(MEMBER_USER) });
    const buy = await app.inject({
      method: "POST",
      url: "/v1/stocks/buy",
      headers: asUser(MEMBER_USER),
      payload: { symbol: "SIELA", shares: 1 },
    });

    expect(state.json()).toEqual({ enabled: false, market: null, portfolio: null });
    expect(buy.statusCode).toBe(400);
    expect(buy.json().error.code).toBe("feature_disabled");
  });

  it("buys and sells for the header user and returns the fresh market", async () => {
    const economy = economyStub({
      getMarket: vi.fn(async () => market),
      getPortfolio: vi.fn(async () => portfolio),
    });
    const { app } = server({ economy });
    const buy = await app.inject({
      method: "POST",
      url: "/v1/stocks/buy",
      headers: asUser(MEMBER_USER),
      payload: { symbol: "siela", shares: 2 },
    });
    const sell = await app.inject({
      method: "POST",
      url: "/v1/stocks/sell",
      headers: asUser(MEMBER_USER),
      payload: { symbol: "SIELA", shares: 1 },
    });

    expect(buy.statusCode).toBe(200);
    expect(buy.json()).toEqual({
      result: { symbol: "SIELA", shares: 2, price: 100, fee: 1, total: 101, balance: 399 },
      market,
      portfolio,
    });
    expect(sell.statusCode).toBe(200);
    expect(economy.buyStock).toHaveBeenCalledWith(GUILD_A, MEMBER_USER, "SIELA", 2);
    expect(economy.sellStock).toHaveBeenCalledWith(GUILD_A, MEMBER_USER, "SIELA", 1);
  });

  it("rejects a spoofed user in the trade body", async () => {
    const economy = economyStub();
    const { app } = server({ economy });
    const response = await app.inject({
      method: "POST",
      url: "/v1/stocks/buy",
      headers: asUser(MEMBER_USER),
      payload: { symbol: "SIELA", shares: 1, userId: ADMIN_USER },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("validation_error");
    expect(economy.buyStock).not.toHaveBeenCalled();
  });

  it("rejects an unknown symbol and maps trade failures to a user message", async () => {
    const economy = economyStub({
      buyStock: vi.fn(async () => { throw new Error("INSUFFICIENT_FUNDS"); }),
    });
    const { app } = server({ economy });
    const unknown = await app.inject({
      method: "POST",
      url: "/v1/stocks/buy",
      headers: asUser(MEMBER_USER),
      payload: { symbol: "NOPE", shares: 1 },
    });
    const broke = await app.inject({
      method: "POST",
      url: "/v1/stocks/buy",
      headers: asUser(MEMBER_USER),
      payload: { symbol: "SIELA", shares: 1000 },
    });

    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error.code).toBe("unknown_stock");
    expect(broke.statusCode).toBe(400);
    expect(broke.json().error.code).toBe("trade_failed");
    expect(broke.json().error.message).toBe("You do not have enough SC for that trade.");
  });

  it("rejects shares outside the service limit", async () => {
    const { app } = server();
    const response = await app.inject({
      method: "POST",
      url: "/v1/stocks/buy",
      headers: asUser(MEMBER_USER),
      payload: { symbol: "SIELA", shares: 1_000_001 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("validation_error");
  });
});

describe("ControlServer music member routes", () => {
  const voiceChannel = "333333333333333307";
  const channels: TestChannel[] = [{ id: voiceChannel, name: "General Voice", type: ChannelType.GuildVoice }];

  it("reports the connected channel name and active filter", async () => {
    const musicState = {
      playing: true,
      paused: false,
      volume: 60,
      loop: "off",
      position: 1_000,
      current: null,
      upcoming: [],
      channelId: voiceChannel,
      channelName: null,
      filter: "nightcore",
    };
    const { app } = server({ channels, musicState });
    const response = await app.inject({ method: "GET", url: "/v1/music/state", headers: auth });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      playing: true,
      channelId: voiceChannel,
      channelName: "General Voice",
      filter: "nightcore",
    });
  });

  it("reports no channel and the off filter when the player is idle", async () => {
    const { app } = server();
    const response = await app.inject({ method: "GET", url: "/v1/music/state", headers: auth });
    expect(response.json()).toMatchObject({ channelId: null, channelName: null, filter: "off" });
  });

  it("joins the actor's current voice channel when no channel is supplied", async () => {
    const { app, music } = server({
      channels,
      members: [{ id: MEMBER_USER, displayName: "Grace", administrator: false, voiceChannelId: voiceChannel }],
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/music/join",
      headers: asUser(MEMBER_USER),
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ channelId: voiceChannel });
    expect(music.join).toHaveBeenCalledWith(
      expect.objectContaining({ id: MEMBER_USER, voice: { channelId: voiceChannel } }),
      undefined,
    );
  });

  it("queues for the actor's voice channel without a pasted channel ID", async () => {
    const { app, music } = server({
      channels,
      members: [{ id: MEMBER_USER, displayName: "Grace", administrator: false, voiceChannelId: voiceChannel }],
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/music/play",
      headers: asUser(MEMBER_USER),
      payload: { query: "song" },
    });

    expect(response.statusCode).toBe(200);
    expect(music.play).toHaveBeenCalledWith(
      expect.objectContaining({ id: MEMBER_USER }),
      "song",
      undefined,
      undefined,
    );
  });

  it("still accepts an explicit voice channel alongside the actor", async () => {
    const { app, music } = server({
      channels,
      members: [{ id: MEMBER_USER, displayName: "Grace", administrator: false, voiceChannelId: voiceChannel }],
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/music/join",
      headers: asUser(MEMBER_USER),
      payload: { voiceChannelId: voiceChannel },
    });

    expect(response.statusCode).toBe(200);
    expect(music.join).toHaveBeenCalledWith(expect.objectContaining({ id: MEMBER_USER }), voiceChannel);
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
  const channels: TestChannel[] = [
    { id: "333333333333333301", name: "general", type: ChannelType.GuildText, text: true },
    { id: "333333333333333304", name: "General Voice", type: ChannelType.GuildVoice },
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

  it("returns event state only when x-guild-id is explicit", async () => {
    const { app } = server({ members });
    const missingGuild = await app.inject({ method: "GET", url: "/v1/events", headers: auth });
    const state = await app.inject({ method: "GET", url: "/v1/events", headers: asUser(MEMBER_USER) });

    expect(missingGuild.statusCode).toBe(400);
    expect(missingGuild.json().error.code).toBe("guild_required");
    expect(state.statusCode).toBe(200);
    expect(state.json()).toMatchObject({ enabled: true, schedulerEnabled: true, events: [], runs: [], builtIn: [{ key: "azan" }] });
  });

  it.each([
    ["POST", "/v1/events", { name: "Event", channelId: "333333333333333304", sourceUrl: "https://youtu.be/abcdefghijk", startAt: new Date(Date.now() + 60_000).toISOString(), repeat: "none" }],
    ["PATCH", "/v1/events/1", { name: "Updated" }],
    ["DELETE", "/v1/events/1", undefined],
    ["POST", "/v1/events/1/run", undefined],
  ] as const)("requires a live Administrator for %s %s", async (method, url, payload) => {
    const { app, scheduledEvents } = server({ members });
    const response = await app.inject({ method, url, headers: asUser(MEMBER_USER), ...(payload ? { payload } : {}) });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("forbidden");
    expect(scheduledEvents.create).not.toHaveBeenCalled();
    expect(scheduledEvents.update).not.toHaveBeenCalled();
    expect(scheduledEvents.remove).not.toHaveBeenCalled();
    expect(scheduledEvents.runNow).not.toHaveBeenCalled();
    expect(scheduledEvents.startNow).not.toHaveBeenCalled();
  });

  it("validates voice-channel ownership and strict event bodies", async () => {
    const { app, scheduledEvents } = server({ members, channels });
    const badChannel = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: asUser(ADMIN_USER),
      payload: {
        name: "Event",
        channelId: "333333333333333301",
        sourceUrl: "https://youtu.be/abcdefghijk",
        startAt: new Date(Date.now() + 60_000).toISOString(),
        repeat: "none",
      },
    });
    const extraField = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: asUser(ADMIN_USER),
      payload: {
        name: "Event",
        channelId: "333333333333333304",
        sourceUrl: "https://youtu.be/abcdefghijk",
        startAt: new Date(Date.now() + 60_000).toISOString(),
        repeat: "none",
        private: true,
      },
    });

    expect(badChannel.statusCode).toBe(400);
    expect(badChannel.json().error.code).toBe("invalid_voice_channel");
    expect(extraField.statusCode).toBe(400);
    expect(extraField.json().error.code).toBe("validation_error");
    expect(scheduledEvents.create).not.toHaveBeenCalled();
  });

  it("refuses manual event runs while the feature is off", async () => {
    const { app, scheduledEvents } = server({ members, scheduledEventsEnabled: false });
    const response = await app.inject({
      method: "POST",
      url: "/v1/events/1/run",
      headers: asUser(ADMIN_USER),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("feature_disabled");
    expect(scheduledEvents.runNow).not.toHaveBeenCalled();
    expect(scheduledEvents.startNow).not.toHaveBeenCalled();
  });

  it("returns the manual-run response before deferred playback finishes", async () => {
    const { app, scheduledEvents } = server({ members });
    let releasePlayback: () => void = () => undefined;
    let playbackFinished = false;
    const playback = new Promise<void>((resolve) => { releasePlayback = resolve; });
    scheduledEvents.startNow.mockImplementation(async (_guildId: string, _id: number, triggeredBy: string) => {
      void playback.then(() => { playbackFinished = true; });
      return {
        id: 19,
        eventName: "Morning music",
        status: "running",
        triggeredBy,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        error: null,
      };
    });

    const response = await app.inject({ method: "POST", url: "/v1/events/1/run", headers: asUser(ADMIN_USER) });

    expect(response.statusCode).toBe(200);
    expect(scheduledEvents.startNow).toHaveBeenCalledWith(GUILD_A, 1, ADMIN_USER);
    expect(scheduledEvents.runNow).not.toHaveBeenCalled();
    expect(playbackFinished).toBe(false);
    releasePlayback();
    await playback;
    expect(playbackFinished).toBe(true);
  });

  it("audits event creation, edits, manual runs, and deletion", async () => {
    const { app, audits, scheduledEvents } = server({ members, channels });
    const headers = asUser(ADMIN_USER);
    const created = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers,
      payload: {
        name: "  Morning  ",
        channelId: "333333333333333304",
        sourceUrl: "https://youtu.be/abcdefghijk",
        startAt: new Date(Date.now() + 60_000).toISOString(),
        repeat: "daily",
      },
    });
    const updated = await app.inject({ method: "PATCH", url: "/v1/events/1", headers, payload: { enabled: false } });
    const ran = await app.inject({ method: "POST", url: "/v1/events/1/run", headers });
    const deleted = await app.inject({ method: "DELETE", url: "/v1/events/1", headers });

    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ enabled: true, events: [{ name: "Morning" }] });
    expect(updated.statusCode).toBe(200);
    expect(ran.statusCode).toBe(200);
    expect(deleted.statusCode).toBe(200);
    expect(scheduledEvents.create).toHaveBeenCalledWith(GUILD_A, expect.objectContaining({ enabled: true }), ADMIN_USER);
    expect(scheduledEvents.update).toHaveBeenCalledWith(GUILD_A, 1, { enabled: false }, ADMIN_USER);
    expect(scheduledEvents.startNow).toHaveBeenCalledWith(GUILD_A, 1, ADMIN_USER);
    expect(audits.map((entry) => (entry as { action: string }).action)).toEqual([
      "scheduled_event.create",
      "scheduled_event.update",
      "scheduled_event.run",
      "scheduled_event.delete",
    ]);
    expect(audits[0]).toMatchObject({ actorId: ADMIN_USER, targetType: "scheduled_event", before: null });
  });
});
