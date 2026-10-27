import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { TtsService } from "./tts.js";
import type { Logger } from "../lib/logger.js";
import type { BotConfig } from "@siela/config";

const logger = { info: () => undefined, warn: () => undefined } as unknown as Logger;
const config = {
  NODE_ID: "commander",
  ROUTER_URL: "http://router:3100",
  MCP_TOKEN: "token-1234567890123456",
} as unknown as BotConfig;

describe("TtsService fleet sessions", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records and forgets remote sessions without touching local voice", async () => {
    const tts = new TtsService(null, config, logger);
    expect(tts.sessionNode("g1")).toBeNull();
    tts.recordRemoteSession("g1", "voice-1", "ch1");
    expect(tts.sessionNode("g1")).toBe("voice-1");
    expect(tts.sessionChannel("g1")).toBe("ch1");
    expect(tts.isEnabled("g1")).toBe(true);
    expect(tts.isLocal("g1")).toBe(false);
    tts.forgetSession("g1");
    expect(tts.sessionNode("g1")).toBeNull();
    expect(tts.isEnabled("g1")).toBe(false);
  });

  it("forwards spoken utterances to the owning node", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${String(url)}`);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    const tts = new TtsService(null, config, logger);
    tts.recordRemoteSession("g1", "voice-1", "ch1");
    const message = {
      inGuild: () => true,
      guild: { id: "g1", members: { fetch: async () => null }, channels: { cache: new Map(), fetch: async () => null }, roles: { cache: new Map(), fetch: async () => null } },
      channel: { id: "ch1" },
      author: { bot: false, id: "u1", displayName: "U", username: "U" },
      webhookId: null,
      content: "hello there",
      member: null,
      mentions: { members: new Map(), users: new Map() },
      stickers: { size: 0 },
      attachments: { size: 0, first: () => undefined },
    } as never;
    await tts.speakMessage(message);
    expect(calls).toContain("POST http://router:3100/v1/tts/speak");
  });
});
