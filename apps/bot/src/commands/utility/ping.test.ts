import { describe, expect, it, vi } from "vitest";
import { MessageFlags } from "discord.js";
import type { CommandContext, ReplyPayload, Services } from "../../framework/types.js";
import { pingCommand } from "./ping.js";

function makeCtx() {
  const reply = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    client: { ws: { ping: 42 }, uptime: 123456 } as CommandContext["client"],
    services: {} as unknown as Services,
    author: { id: "user-1" } as CommandContext["author"],
    reply,
    guild: {} as CommandContext["guild"],
    member: {} as CommandContext["member"],
    channel: {} as CommandContext["channel"],
    args: [],
    rawArgs: "",
    commandName: "ping",
    source: "prefix",
  } as unknown as CommandContext;
  return { ctx, reply };
}

describe("ping command", () => {
  it("does not claim database status", async () => {
    const { ctx, reply } = makeCtx();
    await pingCommand.execute(ctx);
    const payload = reply.mock.calls[0]?.[0] as ReplyPayload;
    const text = JSON.stringify(payload);
    expect(text).not.toContain("Database");
    expect(text).toContain("Gateway");
    expect(text).toContain("Music");
    expect(text).toContain("Uptime");
    expect(payload?.flags).toBe(MessageFlags.IsComponentsV2);
  });
});