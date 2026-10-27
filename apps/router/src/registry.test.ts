import { describe, expect, it } from "vitest";
import { FleetRegistry, type RegistryStore } from "./registry.js";

function store(records: Record<string, string>): RegistryStore {
  return {
    scanKeys: async (pattern: string) => {
      const prefix = pattern.replace(/\*$/, "");
      return Object.keys(records).filter((key) => key.startsWith(prefix));
    },
    mget: async (keys: string[]) => keys.map((key) => records[key] ?? null),
  };
}

const live = (id: string, guild: string | null) =>
  JSON.stringify({ nodeId: id, baseUrl: `http://${id}:3101`, guildId: guild });

describe("FleetRegistry", () => {
  it("scopes to the guild: only live heartbeats for that guild count", async () => {
    const registry = new FleetRegistry(
      store({
        "siela:fleet:node:commander": live("commander", "g1"),
        "siela:fleet:node:voice-1": live("voice-1", "g1"),
        "siela:fleet:node:other": live("other", "g2"),
        "siela:fleet:node:binding": live("binding", null),
      }),
      [{ id: "commander", baseUrl: "http://stale:3101" }],
    );
    expect(await registry.list("g1")).toEqual([
      { id: "commander", baseUrl: "http://commander:3101" },
      { id: "voice-1", baseUrl: "http://voice-1:3101" },
    ]);
    expect(await registry.list("g2")).toEqual([{ id: "other", baseUrl: "http://other:3101" }]);
  });

  it("lone commander yields a semaphore of one", async () => {
    const registry = new FleetRegistry(
      store({ "siela:fleet:node:commander": live("commander", "g1") }),
      [{ id: "commander", baseUrl: "http://stale:3101" }],
    );
    expect(await registry.list("g1")).toEqual([{ id: "commander", baseUrl: "http://commander:3101" }]);
  });

  it("carries the ttsMix capability from the heartbeat", async () => {
    const registry = new FleetRegistry(
      store({
        "siela:fleet:node:commander": live("commander", "g1"),
        "siela:fleet:node:voice-1": JSON.stringify({
          nodeId: "voice-1",
          baseUrl: "http://voice-1:3101",
          guildId: "g1",
          ttsMix: true,
        }),
      }),
      [],
    );
    const nodes = await registry.list("g1");
    expect(nodes.find((node) => node.id === "voice-1")?.ttsMix).toBe(true);
    expect(nodes.find((node) => node.id === "commander")?.ttsMix).toBeUndefined();
  });

  it("falls back to static nodes when Valkey is unreachable", async () => {
    const failing: RegistryStore = {
      scanKeys: async () => {
        throw new Error("down");
      },
      mget: async () => [],
    };
    const registry = new FleetRegistry(failing, [{ id: "commander", baseUrl: "http://x:3101" }]);
    expect(await registry.list("g1")).toEqual([{ id: "commander", baseUrl: "http://x:3101" }]);
  });

  it("unions static and live without a guild scope", async () => {
    const registry = new FleetRegistry(
      store({ "siela:fleet:node:voice-1": live("voice-1", "g9") }),
      [{ id: "commander", baseUrl: "http://bot-control:3101" }],
    );
    expect(await registry.list()).toEqual([
      { id: "commander", baseUrl: "http://bot-control:3101" },
      { id: "voice-1", baseUrl: "http://voice-1:3101" },
    ]);
  });

  it("ignores corrupt entries (TTL clears them)", async () => {
    const registry = new FleetRegistry(store({ "siela:fleet:node:bad": "not-json{" }), []);
    expect(await registry.list("g1")).toEqual([]);
  });
});
