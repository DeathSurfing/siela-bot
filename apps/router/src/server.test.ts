import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authHeaders, stubFleetFetch, withRouterServer } from "./testHelpers.js";

const PORT = 32199;
const NODES = "commander=http://n1:3101,voice-1=http://n2:3101";

describe("RouterServer session + semaphore", () => {
  let stub: { calls: string[] };
  let busy = false;

  beforeEach(() => {
    busy = false;
    stub = stubFleetFetch({
      musicBusy: [],
      onCall: () => undefined,
    });
    void busy;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preempts the session: clears and disconnects every node", async () => {
    await withRouterServer(PORT, NODES, async (base) => {
      const response = await fetch(`${base}/v1/session/preempt`, {
        method: "POST",
        headers: authHeaders(),
        body: "{}",
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as Array<{ nodeId: string; ok: boolean }>;
      expect(body).toEqual([
        { nodeId: "commander", ok: true },
        { nodeId: "voice-1", ok: true },
      ]);
      for (const node of ["n1", "n2"]) {
        expect(stub.calls).toContain(`POST http://${node}:3101/internal/music/clear`);
        expect(stub.calls).toContain(`POST http://${node}:3101/internal/music/disconnect`);
      }
    });
  });

  it("auto-routes play to a free node", async () => {
    await withRouterServer(PORT, NODES, async (base) => {
      const response = await fetch(`${base}/v1/music/play`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ query: "song" }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { nodeId: string };
      expect(body.nodeId).toBe("commander");
    });
  });

  it("rejects 429 when the fleet is full", async () => {
    vi.unstubAllGlobals();
    stubFleetFetch({ musicBusy: ["n1:3101", "n2:3101"] });
    await withRouterServer(PORT, NODES, async (base) => {
      const response = await fetch(`${base}/v1/music/play`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ query: "song" }),
      });
      expect(response.status).toBe(429);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("all_nodes_busy");
    });
  });
});
