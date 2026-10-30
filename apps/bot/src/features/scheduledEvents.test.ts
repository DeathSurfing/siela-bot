import { afterEach, describe, expect, it, vi } from "vitest";
import { type Database, type ScheduledVoiceEventRow } from "@siela/db";
import type { Guild } from "discord.js";
import type { Logger } from "../lib/logger.js";
import { nextScheduledRun, normalizeYouTubeUrl, ScheduledEventService } from "./scheduledEvents.js";

describe("normalizeYouTubeUrl", () => {
  it.each([
    "https://youtube.com/watch?v=abcdefghijk",
    "https://www.youtube.com/watch?v=abcdefghijk",
    "https://m.youtube.com/watch?v=abcdefghijk",
    "https://music.youtube.com/watch?v=abcdefghijk",
    "https://youtu.be/abcdefghijk",
    "https://youtube.com/shorts/abcdefghijk",
    "https://youtube.com/live/abcdefghijk",
    "https://youtube.com/embed/abcdefghijk",
  ])("normalizes %s", (url) => {
    expect(normalizeYouTubeUrl(url)).toBe("https://www.youtube.com/watch?v=abcdefghijk");
  });

  it.each([
    "https://youtube.com/playlist?list=PL123",
    "https://youtube.com/watch?list=PL123",
    "https://notyoutube.com/watch?v=abcdefghijk",
    "https://youtube.com.evil.example/watch?v=abcdefghijk",
    "https://youtube.com/watch?v=short",
    "https://youtube.com/watch?v=abcdefghijk&v=zyxwvutsrqp",
    "https://youtu.be/abcdefghijk/extra",
  ])("rejects %s", (url) => {
    expect(() => normalizeYouTubeUrl(url)).toThrow();
  });
});

describe("nextScheduledRun", () => {
  const from = new Date("2026-01-01T12:00:00.000Z");

  it("returns null for one-off events", () => {
    expect(nextScheduledRun(from, "none", new Date("2026-01-01T11:00:00.000Z"))).toBeNull();
  });

  it("keeps the first daily run if it is still in the future", () => {
    expect(nextScheduledRun(from, "daily", new Date("2026-01-01T11:00:00.000Z"))).toEqual(from);
  });

  it("catches a daily event up to the first run after now", () => {
    expect(nextScheduledRun(from, "daily", new Date("2026-01-04T12:00:00.000Z"))).toEqual(
      new Date("2026-01-05T12:00:00.000Z"),
    );
  });

  it("catches a weekly event up to the first run after now", () => {
    expect(nextScheduledRun(from, "weekly", new Date("2026-01-15T12:00:00.000Z"))).toEqual(
      new Date("2026-01-22T12:00:00.000Z"),
    );
  });
});

describe("ScheduledEventService.runNow", () => {
  const guildId = "111111111111111111";
  const actorId = "222222222222222222";
  const logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as unknown as Logger;

  afterEach(() => vi.useRealTimers());

  function event(repeat: string, nextRunAt: Date | null): ScheduledVoiceEventRow {
    const startAt = new Date("2026-01-01T12:00:00.000Z");
    return {
      id: 7,
      guildId,
      name: "Morning music",
      channelId: "333333333333333333",
      sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      repeat,
      enabled: true,
      startAt,
      nextRunAt,
      lastRunAt: null,
      lastStatus: null,
      lastError: null,
      runCount: 0,
      createdBy: actorId,
      createdAt: startAt,
      updatedAt: startAt,
    };
  }

  function fakeDatabase(row: ScheduledVoiceEventRow) {
    const updates: Array<Record<string, unknown>> = [];
    const inserted: Array<Record<string, unknown>> = [];
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
      insert: () => ({
        values: (values: Record<string, unknown>) => ({
          returning: async () => {
            inserted.push(values);
            return [{ id: 19, ...values, finishedAt: null, error: null }];
          },
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => { updates.push(values); },
        }),
      }),
    };
    return { db: db as unknown as Database, inserted, updates };
  }

  class TestService extends ScheduledEventService {
    protected override async execute(): Promise<void> {}
    triggerTick(guild: Guild): Promise<void> {
      return this.tickGuild(guild);
    }
  }

  class FailingService extends ScheduledEventService {
    protected override async execute(): Promise<void> {
      throw new Error("stream failed");
    }
  }

  function service(db: Database): TestService {
    const instance = new TestService(null, logger, false, "Fajr", undefined, undefined, undefined, null, null, async () => true, db);
    instance.start({ id: guildId } as Guild);
    return instance;
  }

  it("disables a one-off after a successful run when the scheduler config is off", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    const fake = fakeDatabase(event("none", new Date("2026-01-01T12:00:00.000Z")));
    const instance = service(fake.db);

    const run = await instance.runNow(guildId, 7, actorId);
    const completion = fake.updates.at(-1);

    expect(instance.schedulerEnabled).toBe(false);
    expect(run).toMatchObject({ status: "success", triggeredBy: actorId, eventName: "Morning music" });
    expect(fake.inserted[0]).toMatchObject({ status: "running", triggeredBy: actorId });
    expect(completion).toMatchObject({ enabled: false, lastStatus: "success", nextRunAt: null, lastError: null });
    instance.stop();
  });

  it("advances a missed daily run to the first time after now", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-04T12:00:00.000Z"));
    const fake = fakeDatabase(event("daily", new Date("2026-01-01T12:00:00.000Z")));
    const instance = service(fake.db);

    await instance.runNow(guildId, 7, actorId);

    expect(fake.updates.at(-1)).toMatchObject({
      enabled: true,
      lastStatus: "success",
      nextRunAt: new Date("2026-01-05T12:00:00.000Z"),
    });
    instance.stop();
  });

  it("records failed playback and releases the guild guard", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    const fake = fakeDatabase(event("daily", new Date("2026-01-01T12:00:00.000Z")));
    const instance = new FailingService(null, logger, false, "Fajr", undefined, undefined, undefined, null, null, async () => true, fake.db);
    instance.start({ id: guildId } as Guild);

    const first = await instance.runNow(guildId, 7, actorId);
    const second = await instance.runNow(guildId, 7, actorId);

    expect(first).toMatchObject({ status: "failed", error: "stream failed" });
    expect(second.status).toBe("failed");
    instance.stop();
  });

  it("rejects a second manual playback while the first is active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    const fake = fakeDatabase(event("daily", new Date("2026-01-01T12:00:00.000Z")));
    let entered: () => void = () => undefined;
    let release: () => void = () => undefined;
    const playbackStarted = new Promise<void>((resolve) => { entered = resolve; });
    class BlockingService extends ScheduledEventService {
      protected override async execute(): Promise<void> {
        entered();
        await new Promise<void>((resolve) => { release = resolve; });
      }
    }
    const instance = new BlockingService(null, logger, false, "Fajr", undefined, undefined, undefined, null, null, async () => true, fake.db);
    instance.start({ id: guildId } as Guild);

    const first = instance.runNow(guildId, 7, actorId);
    await playbackStarted;
    await expect(instance.runNow(guildId, 7, actorId)).rejects.toThrow("A voice event is already running");
    release();
    await first;
    instance.stop();
  });

  it("ignores a scheduler tick while the same guild is already being processed", async () => {
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const checkStarted = new Promise<void>((resolve) => { entered = resolve; });
    const checkGate = new Promise<void>((resolve) => { release = resolve; });
    const isEnabled = vi.fn(async () => {
      entered();
      await checkGate;
      return false;
    });
    const instance = new TestService(null, logger, false, "Fajr", undefined, undefined, undefined, null, null, isEnabled);
    const guild = { id: guildId } as Guild;
    instance.start(guild);

    const first = instance.triggerTick(guild);
    await checkStarted;
    await instance.triggerTick(guild);
    expect(isEnabled).toHaveBeenCalledTimes(1);
    release();
    await first;
    instance.stop();
  });
});
