import { describe, expect, it } from "vitest";
import { parseArgs, parsePrefixCommand, stripPrefix } from "./prefix.js";

describe("parseArgs", () => {
  it("splits whitespace and respects quotes", () => {
    expect(parseArgs('play "hello world" now')).toEqual(["play", "hello world", "now"]);
    expect(parseArgs("a 'b c' d")).toEqual(["a", "b c", "d"]);
  });
});

describe("stripPrefix", () => {
  it("strips a literal prefix", () => {
    expect(stripPrefix("!help me", "!", "123")).toEqual({ rest: "help me", usedMention: false });
  });

  it("strips a mention prefix", () => {
    expect(stripPrefix("<@123> help", "!", "123")).toEqual({ rest: "help", usedMention: true });
    expect(stripPrefix("<@!123> help", "!", "123")).toEqual({ rest: "help", usedMention: true });
  });

  it("returns null when no prefix matches", () => {
    expect(stripPrefix("hello", "!", "123")).toBeNull();
  });
});

describe("parsePrefixCommand", () => {
  it("parses command and args", () => {
    expect(parsePrefixCommand("!vc permit @user", "!", "123")).toEqual({
      name: "vc",
      args: ["permit", "@user"],
      rawArgs: "permit @user",
      usedMention: false,
    });
  });

  it("is case-insensitive for the command name", () => {
    expect(parsePrefixCommand("!HELP", "!", "123")?.name).toBe("help");
  });
});
