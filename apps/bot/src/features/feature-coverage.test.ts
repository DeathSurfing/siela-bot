import { describe, expect, it } from "vitest";
import { featureForCommand } from "@siela/shared";
import { commands } from "../commands/index.js";
import { CommandRegistry } from "../framework/registry.js";

const ALWAYS_ON = new Set(["help", "ping", "privacy", "config", "features", "prefix", "musicconfig"]);

describe("feature catalog coverage", () => {
  it("maps every command to a feature or lists it as always on", () => {
    const unmapped = commands
      .filter((command) => !featureForCommand(command.name) && !ALWAYS_ON.has(command.name))
      .map((command) => command.name);
    expect(unmapped).toEqual([]);
  });

  it("registers every command without a duplicate name or alias", () => {
    expect(() => new CommandRegistry().register(...commands)).not.toThrow();
  });

  it("does not map a command to two features", () => {
    const seen = new Map<string, number>();
    for (const command of commands) {
      const feature = featureForCommand(command.name);
      if (feature) seen.set(command.name, (seen.get(command.name) ?? 0) + 1);
    }
    expect([...seen.values()].every((count) => count === 1)).toBe(true);
  });
});
