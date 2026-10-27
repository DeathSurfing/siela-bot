import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterServer } from "./server.js";
import { createLogger } from "./logger.js";

const PORT = 32198;
const TOKEN = "test-token-12345678";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Router TTS routes", () => {
  const calls: string[] = [];
  let musicBusy: string[] = [];
  let ttsOn: string[] = [];

  beforeEach(() => {
    calls.length = 0;
    musicBusy = [];
    ttsOn = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const target = String(url);
        if (target.startsWith("http://127.0.0.1")) return realFetch(target, init);
        calls.push(`${init?.method ?? "GET"} ${target}`);
        const host = target.split("/")[2] ?? "";
        if (target.endsWith("/internal/music/state")) {
          const busy = musicBusy.includes(host);
          return jsonResponse({ playing: busy, current: busy ? { title: "t" } : null });
        }
        if (target.endsWith("/internal/tts/state")) {
          return jsonResponse({ enabled: ttsOn.includes(host), channelId: "ch1" });
        }
        if (target.endsWith("/internal/tts/enable")) return jsonResponse({ ok: true });
        if (target.endsWith("/internal/tts/disable")) return jsonResponse({ ok: true });
        if (target.endsWith("/internal/music/clear")) return jsonResponse({ ok: true });
        if (target.endsWith("/internal/music/disconnect")) return jsonResponse({ ok: true });
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
      nodesRaw: "commander=http://commander:3101,voice-1=http://voice-1:3101",
      guildId: null,
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

  it("auto-enables TTS on a free node", async () => {
    musicBusy = ["commander:3101"];
    await withServer(async (base) => {
      const response = await fetch(`${base}/v1/tts/enable`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ channelId: "ch1" }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ nodeId: "voice-1" });
    });
  });

  it("rejects TTS enable when every node is busy", async () => {
    musicBusy = ["commander:3101"];
    ttsOn = ["voice-1:3101"];
    await withServer(async (base) => {
      const response = await fetch(`${base}/v1/tts/enable`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ channelId: "ch1" }),
      });
      expect(response.status).toBe(429);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("all_nodes_busy");
    });
  });

  it("preempt skips TTS-active nodes", async () => {
    ttsOn = ["voice-1:3101"];
    await withServer(async (base) => {
      const response = await fetch(`${base}/v1/session/preempt`, {
        method: "POST",
        headers: auth,
        body: "{}",
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as Array<{ nodeId: string; ok: boolean; skipped?: string }>;
      expect(body).toContainEqual({ nodeId: "voice-1", ok: true, skipped: "tts" });
      expect(body).toContainEqual({ nodeId: "commander", ok: true });
      expect(calls).not.toContain("POST http://voice-1:3101/internal/music/disconnect");
    });
  });
});
