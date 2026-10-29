import { describe, expect, it } from "vitest";
import type { Client, Guild } from "discord.js";
import { ControlServer } from "./server.js";
import type { Services } from "../framework/types.js";
import type { Logger } from "../lib/logger.js";

const GUILD_A = "111111111111111111";
const GUILD_B = "222222222222222222";
const TOKEN = "test-token-0123456789abcdef";

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as unknown as Logger;

function guild(id: string, name: string): Guild {
  return {
    id,
    name,
    memberCount: 7,
    ownerId: "999999999999999999",
    joinedTimestamp: 1_710_000_000_000,
    iconURL: () => null,
  } as unknown as Guild;
}

function server(options: { multiGuild?: boolean; features?: unknown; musicEnabled?: boolean } = {}) {
  const guilds = new Map<string, Guild>([
    [GUILD_A, guild(GUILD_A, "Alpha")],
    [GUILD_B, guild(GUILD_B, "Beta")],
  ]);
  const ids = options.multiGuild ? [GUILD_A, GUILD_B] : [GUILD_A];
  const audits: unknown[] = [];
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
    audit: { log: async (entry: unknown) => { audits.push(entry); } },
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
  return { app: instance.instance, audits };
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
