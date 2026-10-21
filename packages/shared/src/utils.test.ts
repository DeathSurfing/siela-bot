import { describe, expect, it } from "vitest";
import {
  chunkString,
  formatDuration,
  parseDuration,
  prefixSchema,
  protectMentions,
  renderTemplate,
  sanitizeChannelName,
  truncate,
} from "./index.js";

describe("formatDuration", () => {
  it("formats short and long durations", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(3_661_000)).toBe("1:01:01");
  });
});

describe("parseDuration", () => {
  it("parses seconds, clock, and unit forms", () => {
    expect(parseDuration("90")).toBe(90_000);
    expect(parseDuration("1:30")).toBe(90_000);
    expect(parseDuration("1:02:03")).toBe(3_723_000);
    expect(parseDuration("1h2m3s")).toBe(3_723_000);
    expect(parseDuration("nope")).toBeNull();
  });
});

describe("prefixSchema", () => {
  it("accepts punctuation and rejects words", () => {
    expect(prefixSchema.safeParse("?").success).toBe(true);
    expect(prefixSchema.safeParse("!!").success).toBe(true);
    expect(prefixSchema.safeParse("hello").success).toBe(false);
    expect(prefixSchema.safeParse("@").success).toBe(false);
    expect(prefixSchema.safeParse("").success).toBe(false);
  });
});

describe("renderTemplate", () => {
  it("replaces known placeholders", () => {
    expect(
      renderTemplate("Welcome {mention} to {server}, #{memberCount}!", {
        mention: "<@1>",
        server: "Siela",
        memberCount: 12,
      }),
    ).toBe("Welcome <@1> to Siela, #12!");
  });

  it("leaves unknown placeholders intact", () => {
    expect(renderTemplate("Hi {unknown}", {})).toBe("Hi {unknown}");
  });
});

describe("protectMentions", () => {
  it("round-trips mentions, emoji, and URLs", () => {
    const input = "Hi <@123456789012345678> <#123456789012345678> https://example.com";
    const protectedText = protectMentions(input);
    expect(protectedText.text).not.toContain("<@");
    expect(protectedText.restore(protectedText.text)).toBe(input);
  });
});

describe("sanitizeChannelName", () => {
  it("strips mentions and limits length", () => {
    const result = sanitizeChannelName("<@123456789012345678>  My   VC " + "x".repeat(200));
    expect(result.startsWith("My VC")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(100);
  });
});

describe("truncate and chunk", () => {
  it("truncates and chunks", () => {
    expect(truncate("hello world", 8)).toBe("hello w…");
    expect(chunkString("abcdef", 2)).toEqual(["ab", "cd", "ef"]);
  });
});
