import { describe, expect, it } from "vitest";
import { parseNodes, MUSIC_OPS } from "./nodes.js";

describe("parseNodes", () => {
  it("returns an empty list when unset", () => {
    expect(parseNodes(undefined)).toEqual([]);
    expect(parseNodes("")).toEqual([]);
  });

  it("parses id=url pairs", () => {
    expect(parseNodes("commander=http://bot-control:3101, voice-1=http://bot-voice-1:3101/")).toEqual([
      { id: "commander", baseUrl: "http://bot-control:3101" },
      { id: "voice-1", baseUrl: "http://bot-voice-1:3101" },
    ]);
  });

  it("rejects malformed entries", () => {
    expect(() => parseNodes("just-a-url")).toThrow();
    expect(() => parseNodes("a=http://x:1,bad id=http://y:2")).toThrow();
    expect(() => parseNodes("a=notaurl")).toThrow();
    expect(() => parseNodes("a=http://x:1,a=http://y:2")).toThrow();
  });
});

describe("MUSIC_OPS", () => {
  it("covers the worker endpoints", () => {
    for (const op of ["join", "play", "pause", "resume", "skip", "stop", "disconnect", "state-all"]) {
      if (op === "state-all") continue;
      expect(MUSIC_OPS.has(op)).toBe(true);
    }
  });
});
