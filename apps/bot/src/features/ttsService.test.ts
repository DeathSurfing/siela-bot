import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unloadTtsService, warmupTtsService } from "./ttsService.js";
import type { Logger } from "../lib/logger.js";

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
