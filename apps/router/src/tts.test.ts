import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authHeaders, stubFleetFetch, withRouterServer } from "./testHelpers.js";

const PORT = 32198;
const NODES = "commander=http://commander:3101,voice-1=http://voice-1:3101";

describe("Router TTS routes", () => {
  let stub: { calls: string[] };
  let musicBusy: string[] = [];
  let ttsOn: string[] = [];

  beforeEach(() => {
    musicBusy = [];
    ttsOn = [];
    stub = stubFleetFetch({
      get musicBusy() {
        return musicBusy;
      },
      get ttsOn() {
        return ttsOn;
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
      const response = await fetch(`${base}/v1/session/preempt`, {
        method: "POST",
        headers: authHeaders(),
        body: "{}",
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as Array<{ nodeId: string; ok: boolean; skipped?: string }>;
      expect(body).toContainEqual({ nodeId: "voice-1", ok: true, skipped: "tts" });
      expect(body).toContainEqual({ nodeId: "commander", ok: true });
      expect(stub.calls).not.toContain("POST http://voice-1:3101/internal/music/disconnect");
    });
  });
});
