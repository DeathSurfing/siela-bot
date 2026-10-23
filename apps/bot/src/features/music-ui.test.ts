import { describe, expect, it } from "vitest";
import { MessageFlags } from "discord.js";
import { buildMusicPayload, buildQueuePayload } from "./music-ui.js";
import type { MusicQueueState } from "@siela/shared";

const state: MusicQueueState = {
  playing: true,
  paused: false,
  volume: 80,
  loop: "off",
  position: 1000,
  current: { title: "a*b_c", author: "x[y]z", length: 2000, uri: "https://example.test", artworkUrl: null, isStream: false },
  upcoming: [{ title: "n*m", author: "a[b]", length: 1000, uri: "https://example.test/2", artworkUrl: null, isStream: false }],
};

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

function selectDescriptions(value: unknown): string[] {
  const out: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) out.push(...selectDescriptions(item));
    return out;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.description === "string" && typeof record.value === "string") {
      out.push(record.description);
    }
    for (const key of Object.keys(record)) out.push(...selectDescriptions(record[key]));
  }
  return out;
}

describe("music UI escaping", () => {
  it("escapes markdown metacharacters in now-playing text", () => {
    const payload = buildMusicPayload("guild-1", state);
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    const component = payload.components?.[0] as { toJSON(): unknown } | undefined;
    const texts = textDisplays(component?.toJSON());
    expect(texts.some((text) => text.includes("a\\*b\\_c"))).toBe(true);
    expect(texts.some((text) => text.includes("x\\[y\\]z"))).toBe(true);
  });

  it("escapes Next text", () => {
    const payload = buildMusicPayload("guild-1", state);
    const component = payload.components?.[0] as { toJSON(): unknown } | undefined;
    const texts = textDisplays(component?.toJSON());
    expect(texts.some((text) => text.includes("n\\*m"))).toBe(true);
    expect(texts.some((text) => text.includes("a\\[b\\]"))).toBe(true);
  });

  it("describes the current loop mode in More controls", () => {
    const payload = buildMusicPayload("guild-1", state);
    const component = payload.components?.[0] as { toJSON(): unknown } | undefined;
    const descriptions = selectDescriptions(component?.toJSON());
    expect(descriptions).toContain("Currently off");
  });

  it("escapes buildQueuePayload current and upcoming text", () => {
    const payload = buildQueuePayload("guild-1", state);
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    const component = payload.components?.[0] as { toJSON(): unknown } | undefined;
    const texts = textDisplays(component?.toJSON());
    expect(texts.some((text) => text.includes("a\\*b\\_c"))).toBe(true);
    expect(texts.some((text) => text.includes("n\\*m"))).toBe(true);
  });
});