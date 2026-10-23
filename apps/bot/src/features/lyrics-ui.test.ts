import { describe, expect, it } from "vitest";
import { MessageFlags } from "discord.js";
import { buildLyricsPayload } from "./lyrics-ui.js";
import type { MusicTrackInfo } from "@siela/shared";
import type { LyricsResult } from "./lyrics.js";

const track: MusicTrackInfo = { title: "a*b", author: "x[y]", length: 1000, uri: "https://example.test", artworkUrl: null, isStream: false };

function textDisplays(value: unknown): string[] {
  const out: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) out.push(...textDisplays(item));
    return out;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.type === 10 && typeof record.content === "string") out.push(record.content);
    for (const key of Object.keys(record)) {
      if (key === "content") continue;
      out.push(...textDisplays(record[key]));
    }
  }
  return out;
}

describe("lyrics UI", () => {
  it("escapes header text and uses Source footer", () => {
    const result: LyricsResult = { trackName: "t", artistName: "a", albumName: null, duration: null, instrumental: false, plainLyrics: "hello", syncedLyrics: null };
    const payload = buildLyricsPayload(track, result);
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    const component = payload.components?.[0] as { toJSON(): unknown } | undefined;
    const texts = textDisplays(component?.toJSON());
    expect(texts.some((text) => text.includes("a\\*b"))).toBe(true);
    expect(texts.some((text) => text.includes("x\\[y\\]"))).toBe(true);
    expect(texts.some((text) => text.includes("Source · LRCLIB"))).toBe(true);
  });

  it("keeps the full-text attachment when lyrics exceed the inline limit", () => {
    const longLyrics = "x".repeat(2000);
    const result: LyricsResult = { trackName: "t", artistName: "a", albumName: null, duration: null, instrumental: false, plainLyrics: longLyrics, syncedLyrics: null };
    const payload = buildLyricsPayload(track, result);
    const component = payload.components?.[0] as { toJSON(): unknown } | undefined;
    const texts = textDisplays(component?.toJSON());
    expect(texts.some((text) => text.includes("Full lyrics attached"))).toBe(true);
    expect(payload.files?.length).toBe(1);
  });
});