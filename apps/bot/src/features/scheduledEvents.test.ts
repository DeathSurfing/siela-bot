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

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

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

  it("returns a running view while manual playback completes in the background", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    const fake = fakeDatabase(event("daily", new Date("2026-01-01T12:00:00.000Z")));
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const playbackStarted = new Promise<void>((resolve) => { entered = resolve; });
    const playbackGate = new Promise<void>((resolve) => { release = resolve; });
    class BackgroundService extends ScheduledEventService {
      protected override async execute(): Promise<void> {
        entered();
        await playbackGate;
      }
    }
    const instance = new BackgroundService(null, logger, false, "Fajr", undefined, undefined, undefined, null, null, async () => true, fake.db);
    instance.start({ id: guildId } as Guild);

    const run = await instance.startNow(guildId, 7, actorId);
    expect(run).toMatchObject({ status: "running", triggeredBy: actorId, eventName: "Morning music", finishedAt: null });
    await playbackStarted;
    expect(fake.updates[0]).toMatchObject({ lastStatus: "running", lastError: null });
    await expect(instance.startNow(guildId, 7, actorId)).rejects.toThrow("A voice event is already running");

    release();
    await vi.waitFor(() => expect(fake.updates.at(-1)).toMatchObject({ lastStatus: "success", runCount: expect.anything() }));
    expect(fake.updates.find((update) => update.status === "success")).toMatchObject({ status: "success" });
    instance.stop();
  });

  it("releases the background-run guard after playback fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    const fake = fakeDatabase(event("daily", new Date("2026-01-01T12:00:00.000Z")));
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const playbackStarted = new Promise<void>((resolve) => { entered = resolve; });
    const playbackGate = new Promise<void>((resolve) => { release = resolve; });
    class FailingBackgroundService extends ScheduledEventService {
      protected override async execute(): Promise<void> {
        entered();
        await playbackGate;
        throw new Error("stream failed");
      }
    }
    const instance = new FailingBackgroundService(null, logger, false, "Fajr", undefined, undefined, undefined, null, null, async () => true, fake.db);
    instance.start({ id: guildId } as Guild);

    expect((await instance.startNow(guildId, 7, actorId)).status).toBe("running");
    await playbackStarted;
    release();
    await vi.waitFor(() => expect(fake.updates.at(-1)).toMatchObject({ lastStatus: "failed", lastError: "stream failed" }));
    await expect(instance.startNow(guildId, 7, actorId)).resolves.toMatchObject({ status: "running" });
    instance.stop();
  });

  it("accepts an unchanged past start time but rejects a changed stale time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T12:00:00.000Z"));
    const past = new Date("2026-01-01T12:00:00.000Z");
    const row = { ...event("daily", past), startAt: past };
    const updates: Array<Record<string, unknown>> = [];
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
      update: () => ({ set: (values: Record<string, unknown>) => ({ where: () => ({ returning: async () => {
        updates.push(values);
        return [{ ...row, ...values }];
      } }) }) }),
    } as unknown as Database;
    const instance = new ScheduledEventService(null, logger, false, "Fajr", undefined, undefined, undefined, null, null, undefined, db);

    await expect(instance.update(guildId, 7, { name: "Renamed", startAt: new Date(past.toISOString()) }, actorId)).resolves.toMatchObject({ name: "Renamed" });
    expect(updates[0]).not.toHaveProperty("startAt");
    await expect(instance.update(guildId, 7, { startAt: new Date(past.getTime() + 1) }, actorId)).rejects.toThrow("Start time must be in the future");
    const future = new Date("2026-01-02T13:00:00.000Z");
    await expect(instance.update(guildId, 7, { startAt: future }, actorId)).resolves.toMatchObject({ startAt: future.toISOString() });
    expect(updates.at(-1)).toMatchObject({ startAt: future });
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

  it("does not record a skipped run for a due event whose playback is already running", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { timings: { Fajr: "23:59" } } }),
    })));
    const row = event("daily", new Date("2026-01-01T11:59:00.000Z"));
    const runs: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    let nextRunId = 1;
    const query = {
      where: () => query,
      orderBy: () => query,
      limit: async () => [row],
    };
    const db = {
      select: () => ({ from: () => query }),
      insert: () => ({ values: (values: Record<string, unknown>) => ({
        returning: async () => {
          const run = { id: nextRunId++, ...values };
          runs.push(run);
          return [run];
        },
      }) }),
      update: () => ({ set: (values: Record<string, unknown>) => ({ where: async () => {
        updates.push(values);
        if (values.status) runs[0] = { ...runs[0], ...values };
        if (values.lastStatus) row.lastStatus = String(values.lastStatus);
        if (values.runCount) row.runCount += 1;
      } }) }),
    } as unknown as Database;
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const playbackStarted = new Promise<void>((resolve) => { entered = resolve; });
    const playbackGate = new Promise<void>((resolve) => { release = resolve; });
    class DeferredSchedulerService extends ScheduledEventService {
      protected override async execute(): Promise<void> {
        entered();
        await playbackGate;
      }
      triggerTick(guild: Guild): Promise<void> {
        return this.tickGuild(guild);
      }
    }
    const instance = new DeferredSchedulerService(null, logger, true, "Fajr", undefined, undefined, undefined, null, null, async () => true, db);
    const guild = { id: guildId } as Guild;
    instance.start(guild);
    await playbackStarted;
    await instance.triggerTick(guild);

    expect(runs).toHaveLength(1);
    expect(row.runCount).toBe(0);
    release();
    await vi.waitFor(() => {
      expect(row.runCount).toBe(1);
      expect(runs[0]).toMatchObject({ status: "success" });
    });
    instance.stop();
  });
});
