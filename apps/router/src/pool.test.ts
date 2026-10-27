import { describe, expect, it } from "vitest";
import { AllNodesBusyError, FleetPool, NoNodesReachableError, type NodePlaybackState } from "./pool.js";
import type { FleetNode } from "./nodes.js";

const nodes: FleetNode[] = [
  { id: "commander", baseUrl: "http://bot-control:3101" },
  { id: "voice-1", baseUrl: "http://bot-voice-1:3101" },
];

const listOf = (list: FleetNode[]) => async (_guildId?: string | null) => list;

function states(byId: Record<string, NodePlaybackState>) {
  return (node: FleetNode): Promise<NodePlaybackState> => {
    const state = byId[node.id];
    if (!state) return Promise.reject(new Error("unreachable"));
    return Promise.resolve(state);
  };
}

const idle = { playing: false, hasCurrent: false, reachable: true };
const busy = { playing: true, hasCurrent: true, reachable: true };

describe("FleetPool", () => {
  it("acquires an idle node", async () => {
    const pool = new FleetPool(listOf(nodes), states({ commander: busy, "voice-1": idle }));
    const node = await pool.acquire();
    expect(node.id).toBe("voice-1");
    expect(pool.reservedCount()).toBe(1);
    pool.release(node.id);
    expect(pool.reservedCount()).toBe(0);
  });

  it("skips reserved nodes", async () => {
    const pool = new FleetPool(listOf(nodes), states({ commander: idle, "voice-1": idle }));
    const first = await pool.acquire();
    const second = await pool.acquire();
    expect(first.id).not.toBe(second.id);
    expect(pool.reservedCount()).toBe(2);
  });

  it("rejects when every node is busy", async () => {
    const pool = new FleetPool(listOf(nodes), states({ commander: busy, "voice-1": busy }));
    await expect(pool.acquire()).rejects.toBeInstanceOf(AllNodesBusyError);
  });

  it("rejects when no node is reachable", async () => {
    const pool = new FleetPool(listOf(nodes), states({}));
    await expect(pool.acquire()).rejects.toBeInstanceOf(NoNodesReachableError);
  });

  it("rejects when the fleet is empty", async () => {
    const pool = new FleetPool(listOf([]), states({}));
    await expect(pool.acquire("g1")).rejects.toBeInstanceOf(NoNodesReachableError);
  });

  it("scopes capacity to the requested guild", async () => {
    const seen: Array<string | null | undefined> = [];
    const pool = new FleetPool(
      async (guildId) => {
        seen.push(guildId);
        return guildId === "g1" ? nodes : [];
      },
      states({ commander: busy, "voice-1": busy }),
    );
    await expect(pool.acquire("g1")).rejects.toBeInstanceOf(AllNodesBusyError);
    await expect(pool.acquire("g2")).rejects.toBeInstanceOf(NoNodesReachableError);
    expect(seen).toEqual(["g1", "g2"]);
  });
});
