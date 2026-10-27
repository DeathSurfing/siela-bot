import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unloadTtsService, warmupTtsService } from "./ttsService.js";
import { TtsService } from "./tts.js";
import type { Logger } from "../lib/logger.js";
import type { BotConfig } from "@siela/config";

const logger = { debug: () => undefined, warn: () => undefined, info: () => undefined } as unknown as Logger;
const original = process.env.TTS_SERVICE_URL;

describe("tts model lifecycle calls", () => {
  beforeEach(() => {
    process.env.TTS_SERVICE_URL = "http://tts:8000/";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (original === undefined) delete process.env.TTS_SERVICE_URL;
    else process.env.TTS_SERVICE_URL = original;
  });

  it("warms up against the configured service", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
      calls.push(String(url));
      return new Response("{}", { status: 200 });
    }));
    await warmupTtsService(logger);
    expect(calls).toEqual(["http://tts:8000/warmup"]);
  });

  it("unloads against the configured service", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
      calls.push(String(url));
      return new Response("{}", { status: 200 });
    }));
    await unloadTtsService(logger);
    expect(calls).toEqual(["http://tts:8000/unload"]);
  });

  it("stays quiet when no service is configured", async () => {
    delete process.env.TTS_SERVICE_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await warmupTtsService(logger);
    await unloadTtsService(logger);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows transport failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(warmupTtsService(logger)).resolves.toBeUndefined();
    await expect(unloadTtsService(logger)).resolves.toBeUndefined();
  });
});

describe("TtsService model lifetime", () => {
  const config = { NODE_ID: "commander", ROUTER_URL: null, MCP_TOKEN: "token-1234567890123456" } as unknown as BotConfig;

  function unloadCalls() {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
      calls.push(String(url));
      return new Response("{}", { status: 200 });
    }));
    return calls;
  }

  it("unloads when nothing is using speech", async () => {
    process.env.TTS_SERVICE_URL = "http://tts:8000";
    const calls = unloadCalls();
    const tts = new TtsService(null, config, logger);
    await tts.maybeUnload("g1");
    expect(calls).toContain("http://tts:8000/unload");
  });

  it("stays loaded while another feature is speaking", async () => {
    process.env.TTS_SERVICE_URL = "http://tts:8000";
    const calls = unloadCalls();
    const tts = new TtsService(null, config, logger);
    tts.setConsumerChecker((guildId) => guildId === "g1");
    await tts.maybeUnload("g1");
    expect(calls).toEqual([]);
    await tts.maybeUnload("g2");
    expect(calls).toContain("http://tts:8000/unload");
  });
});
