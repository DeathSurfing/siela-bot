import { afterEach, describe, expect, it, vi } from "vitest";
import { CooldownManager } from "./cooldowns.js";

describe("CooldownManager", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports no cooldown before a key is used", () => {
    expect(new CooldownManager().remaining("ping", 1_000)).toBe(0);
  });

  it("counts down and expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const manager = new CooldownManager();

    manager.use("ping");
    expect(manager.remaining("ping", 1_000)).toBe(1_000);

    vi.advanceTimersByTime(400);
    expect(manager.remaining("ping", 1_000)).toBe(600);

    vi.advanceTimersByTime(600);
    expect(manager.remaining("ping", 1_000)).toBe(0);
  });

  it("tracks keys independently", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const manager = new CooldownManager();

    manager.use("ping");
    vi.advanceTimersByTime(1_000);
    manager.use("help");

    expect(manager.remaining("ping", 5_000)).toBe(4_000);
    expect(manager.remaining("help", 5_000)).toBe(5_000);
  });

  it("clears every key", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const manager = new CooldownManager();

    manager.use("ping");
    manager.use("help");
    manager.clear();

    expect(manager.remaining("ping", 5_000)).toBe(0);
    expect(manager.remaining("help", 5_000)).toBe(0);
  });
});
