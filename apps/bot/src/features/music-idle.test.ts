import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { MusicService, IDLE_LEAVE_GRACE_MS, type MusicServiceOptions } from "./music.js";
import type { Logger } from "../lib/logger.js";

const logger = { info: () => undefined, warn: () => undefined, debug: () => undefined } as unknown as Logger;

class TestMusic extends MusicService {
  readonly disconnectCalls: string[] = [];

  override async disconnect(guildId: string): Promise<void> {
    this.disconnectCalls.push(guildId);
  }
}

function makeService(overrides: Partial<MusicServiceOptions> = {}): TestMusic {
  return new TestMusic(
    {} as never,
    {
      backend: "mpv",
      ytdlpPath: "yt-dlp",
      mpvPath: "mpv",
      ffmpegPath: "ffmpeg",
      settings: {} as never,
      ...overrides,
    },
    logger,
    null,
  );
}

describe("idle auto-leave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("disconnects a worker after the grace period", async () => {
    const service = makeService({ leaveOnQueueEnd: true });
    service.scheduleIdleLeave("g1");
    expect(service.disconnectCalls).toEqual([]);
    await vi.advanceTimersByTimeAsync(IDLE_LEAVE_GRACE_MS);
    expect(service.disconnectCalls).toEqual(["g1"]);
  });

  it("new playback cancels the pending leave", async () => {
    const service = makeService({ leaveOnQueueEnd: true });
    service.scheduleIdleLeave("g1");
    service.cancelIdleLeave("g1");
    await vi.advanceTimersByTimeAsync(IDLE_LEAVE_GRACE_MS + 1000);
    expect(service.disconnectCalls).toEqual([]);
  });

  it("stays put on the commander", async () => {
    const service = makeService({ leaveOnQueueEnd: false });
    service.scheduleIdleLeave("g1");
    await vi.advanceTimersByTimeAsync(IDLE_LEAVE_GRACE_MS + 1000);
    expect(service.disconnectCalls).toEqual([]);
  });

  it("stays while a stayConnected guard holds (sticky TTS)", async () => {
    const service = makeService({ leaveOnQueueEnd: true, stayConnected: () => true });
    service.scheduleIdleLeave("g1");
    await vi.advanceTimersByTimeAsync(IDLE_LEAVE_GRACE_MS + 1000);
    expect(service.disconnectCalls).toEqual([]);
  });
});
