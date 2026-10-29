import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authHeaders, stubFleetFetch, withRouterServer } from "./testHelpers.js";

const PORT = 32198;
const NODES = "commander=http://commander:3101,voice-1=http://voice-1:3101";

describe("Router TTS routes", () => {
  let stub: { calls: string[] };
  let musicBusy: string[] = [];
  let ttsOn: string[] = [];
  let musicChannel: Record<string, string> = {};

  beforeEach(() => {
    musicBusy = [];
    ttsOn = [];
    musicChannel = {};
    stub = stubFleetFetch({
      get musicBusy() {
        return musicBusy;
      },
      get ttsOn() {
        return ttsOn;
      },
      get musicChannel() {
        return musicChannel;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("auto-enables TTS on a free node", async () => {
    musicBusy = ["commander:3101"];
    await withRouterServer(PORT, NODES, async (base) => {
      const response = await fetch(`${base}/v1/tts/enable`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ channelId: "ch1" }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ nodeId: "voice-1" });
    });
  });

  it("rejects TTS enable when every node is busy", async () => {
    musicBusy = ["commander:3101"];
    ttsOn = ["voice-1:3101"];
    await withRouterServer(PORT, NODES, async (base) => {
      const response = await fetch(`${base}/v1/tts/enable`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ channelId: "ch1" }),
      });
      expect(response.status).toBe(429);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("all_nodes_busy");
    });
  });

  it("preempt skips TTS-active nodes", async () => {
    ttsOn = ["voice-1:3101"];
    await withRouterServer(PORT, NODES, async (base) => {
      const preempt = await fetch(`${base}/v1/session/preempt`, {
        method: "POST",
        headers: authHeaders(),
        body: "{}",
      });
      expect(preempt.status).toBe(200);
      const body = (await preempt.json()) as Array<{ nodeId: string; ok: boolean; skipped?: string }>;
      expect(body).toContainEqual({ nodeId: "voice-1", ok: true, skipped: "tts" });
      expect(body).toContainEqual({ nodeId: "commander", ok: true });
      expect(stub.calls).not.toContain("POST http://voice-1:3101/internal/music/disconnect");
    });
  });

  it("reuses a node that is already in the requested channel", async () => {
    musicChannel = { "commander:3101": "ch1" };
    await withRouterServer(PORT, NODES, async (base) => {
      const response = await fetch(`${base}/v1/tts/enable`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ channelId: "ch1" }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ nodeId: "commander" });
      expect(stub.calls).toContain("POST http://commander:3101/internal/tts/enable");
    });
  });

  it("skips a connected node that speaks in a different channel", async () => {
    musicBusy = ["commander:3101"];
    musicChannel = { "voice-1:3101": "chA" };
    await withRouterServer(PORT, NODES, async (base) => {
      const response = await fetch(`${base}/v1/tts/enable`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ channelId: "ch1" }),
      });
      expect(response.status).toBe(429);
      expect(stub.calls).not.toContain("POST http://voice-1:3101/internal/tts/enable");
    });
  });
});
