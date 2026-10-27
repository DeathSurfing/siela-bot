import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterServer } from "./server.js";
import { createLogger } from "./logger.js";

const PORT = 32199;
const TOKEN = "test-token-12345678";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("RouterServer session + semaphore", () => {
  const calls: string[] = [];
  let busy = false;

  beforeEach(() => {
    calls.length = 0;
    busy = false;
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const target = String(url);
        if (target.startsWith("http://127.0.0.1")) {
          return realFetch(target, init);
        }
        calls.push(`${init?.method ?? "GET"} ${target}`);
        if (target.endsWith("/internal/music/state")) {
          return jsonResponse({ playing: busy, current: busy ? { title: "t" } : null });
        }
        if (target.endsWith("/internal/music/clear") || target.endsWith("/internal/music/disconnect")) {
          return jsonResponse({ ok: true });
        }
        if (target.endsWith("/internal/music/play")) {
          return jsonResponse({ added: 1 });
        }
        throw new Error(`unexpected fetch: ${target}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
    const server = new RouterServer({
      token: TOKEN,
      commanderUrl: "http://commander:3001",
      nodesRaw: "commander=http://n1:3101,voice-1=http://n2:3101",
      logger: createLogger("silent"),
    });
    await server.start("127.0.0.1", PORT);
    try {
      await fn(`http://127.0.0.1:${PORT}`);
    } finally {
      await server.stop();
    }
  }

  const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

  it("preempts the session: clears and disconnects every node", async () => {
    await withServer(async (base) => {
      const response = await fetch(`${base}/v1/session/preempt`, { method: "POST", headers: auth, body: "{}" });
      expect(response.status).toBe(200);
      const body = (await response.json()) as Array<{ nodeId: string; ok: boolean }>;
      expect(body).toEqual([
        { nodeId: "commander", ok: true },
        { nodeId: "voice-1", ok: true },
      ]);
      for (const node of ["n1", "n2"]) {
        expect(calls).toContain(`POST http://${node}:3101/internal/music/clear`);
        expect(calls).toContain(`POST http://${node}:3101/internal/music/disconnect`);
      }
    });
  });

  it("auto-routes play to a free node", async () => {
    await withServer(async (base) => {
      const response = await fetch(`${base}/v1/music/play`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ query: "song" }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { nodeId: string };
      expect(body.nodeId).toBe("commander");
    });
  });

  it("rejects 429 when the fleet is full", async () => {
    busy = true;
    await withServer(async (base) => {
      const response = await fetch(`${base}/v1/music/play`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ query: "song" }),
      });
      expect(response.status).toBe(429);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("all_nodes_busy");
    });
  });
});
