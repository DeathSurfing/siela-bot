import { describe, expect, it } from "vitest";
import { CommandRegistry } from "../framework/registry.js";
import { commands } from "./index.js";

describe("command registry", () => {
  it("registers every command with no duplicate names or aliases", () => {
    const registry = new CommandRegistry();
    expect(() => registry.register(...commands)).not.toThrow();
    expect(registry.all().length).toBe(commands.length);
  });

  it("resolves the cah game command by name and alias", () => {
    const registry = new CommandRegistry().register(...commands);
    expect(registry.get("cah")?.name).toBe("cah");
    expect(registry.get("cahgame")?.name).toBe("cah");
  });
});
