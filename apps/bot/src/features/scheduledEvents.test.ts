import { describe, expect, it } from "vitest";
import { nextScheduledRun, normalizeYouTubeUrl } from "./scheduledEvents.js";

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
