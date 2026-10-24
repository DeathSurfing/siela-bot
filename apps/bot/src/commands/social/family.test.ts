import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { Guild, GuildMember, User } from "discord.js";
import type { CommandContext, ReplyPayload, Services } from "../../framework/types.js";
import { divorceCommand, runawayCommand } from "./family.js";

function textFromPayload(payload: ReplyPayload | null | undefined): string {
  const component = payload?.components?.[0] as { toJSON(): unknown } | undefined;
  const json = component?.toJSON();
  const out: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (record.type === 10 && typeof record.content === "string") out.push(record.content);
      for (const key of Object.keys(record)) {
        if (key === "content") continue;
        visit(record[key]);
      }
    }
  };
  visit(json);
  if (out.length === 0 && typeof payload?.content === "string") out.push(payload.content);
  return out.join("\n");
}

function makeMessage() {
  const collector = new EventEmitter() as any;
  collector.stop = vi.fn((reason?: string) => {
    setTimeout(() => collector.emit("end", [], reason ?? "time"), 0);
  });
  const message = new EventEmitter() as any;
  message.edit = vi.fn().mockResolvedValue(message);
  message.createMessageComponentCollector = vi.fn(() => collector);
  return { message, collector };
}

function makeCtx(family: any, message: any, args: string[] = []) {
  const reply = vi.fn().mockResolvedValue(message);
  const followUp = vi.fn().mockResolvedValue(null);
  const ctx = {
    guild: {
      id: "guild-1",
      members: { fetch: vi.fn().mockResolvedValue({ displayName: "Spouse" }) },
    } as unknown as Guild,
    member: { displayName: "Actor" } as unknown as GuildMember,
    author: { id: "user-1" } as unknown as User,
    args,
    rawArgs: args.join(" "),
    commandName: "test",
    source: "prefix",
    services: { family } as unknown as Services,
    client: {} as CommandContext["client"],
    channel: {} as CommandContext["channel"],
    interaction: undefined,
    message: undefined,
    reply,
    defer: vi.fn().mockResolvedValue(undefined),
    edit: vi.fn().mockResolvedValue(null),
    followUp,
  } as unknown as CommandContext;
  return { ctx, reply, followUp };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("divorce command", () => {
  it("does not call service on cancel", async () => {
    const { message, collector } = makeMessage();
    const family = {
      getActiveMarriage: vi.fn().mockResolvedValue({ spouseA: "user-1", spouseB: "spouse-1" }),
      divorce: vi.fn().mockResolvedValue("spouse-1"),
    };
    const { ctx, followUp } = makeCtx(family, message);
    (ctx.guild.members.fetch as any).mockResolvedValue({ displayName: "Spouse" });

    await divorceCommand.execute(ctx);

    const interaction = {
      user: { id: "user-1" },
      customId: "family:divorce:cancel",
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    };
    collector.emit("collect", interaction);
    await flush();

    expect(family.divorce).not.toHaveBeenCalled();
    expect(followUp).not.toHaveBeenCalled();
    const edited = message.edit.mock.calls.at(-1)![0] as ReplyPayload;
    expect(textFromPayload(edited)).toContain("Cancelled");
  });

  it("calls service once and follows up on confirm", async () => {
    const { message, collector } = makeMessage();
    const family = {
      getActiveMarriage: vi.fn().mockResolvedValue({ spouseA: "user-1", spouseB: "spouse-1" }),
      divorce: vi.fn().mockResolvedValue("spouse-1"),
    };
    const { ctx, followUp } = makeCtx(family, message);
    (ctx.guild.members.fetch as any).mockResolvedValue({ displayName: "Spouse" });

    await divorceCommand.execute(ctx);

    const interaction = {
      user: { id: "user-1" },
      customId: "family:divorce:confirm",
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    };
    collector.emit("collect", interaction);
    await flush();

    expect(family.divorce).toHaveBeenCalledTimes(1);
    expect(followUp).toHaveBeenCalledTimes(1);
    const followText = textFromPayload(followUp.mock.calls[0]![0] as ReplyPayload);
    expect(followText).toContain("Divorced");
    const edited = message.edit.mock.calls.at(-1)![0] as ReplyPayload;
    expect(textFromPayload(edited)).toContain("Divorce finalized");
  });

  it("keeps Divorce finalized when follow-up fails", async () => {
    const { message, collector } = makeMessage();
    const family = {
      getActiveMarriage: vi.fn().mockResolvedValue({ spouseA: "user-1", spouseB: "spouse-1" }),
      divorce: vi.fn().mockResolvedValue("spouse-1"),
    };
    const { ctx, followUp } = makeCtx(family, message);
    followUp.mockRejectedValue(new Error("followup failed"));
    (ctx.guild.members.fetch as any).mockResolvedValue({ displayName: "Spouse" });

    await divorceCommand.execute(ctx);

    const interaction = {
      user: { id: "user-1" },
      customId: "family:divorce:confirm",
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    };
    collector.emit("collect", interaction);
    await flush();

    expect(family.divorce).toHaveBeenCalledTimes(1);
    const edited = message.edit.mock.calls.at(-1)![0] as ReplyPayload;
    expect(textFromPayload(edited)).toContain("Divorce finalized");
    expect(textFromPayload(edited)).not.toContain("Failed");
  });

  it("does nothing when not married", async () => {
    const { message } = makeMessage();
    const family = {
      getActiveMarriage: vi.fn().mockResolvedValue(null),
      divorce: vi.fn(),
    };
    const { ctx } = makeCtx(family, message);

    await divorceCommand.execute(ctx);

    expect(family.divorce).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith({ content: "You are not currently married.", ephemeral: true });
  });
});

describe("runaway command", () => {
  it("bulk confirm calls service and shows count", async () => {
    const { message, collector } = makeMessage();
    const family = { runaway: vi.fn().mockResolvedValue(2) };
    const { ctx } = makeCtx(family, message, []);

    await runawayCommand.execute(ctx);

    const interaction = {
      user: { id: "user-1" },
      customId: "family:runaway:confirm",
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    };
    collector.emit("collect", interaction);
    await flush();

    expect(family.runaway).toHaveBeenCalledTimes(1);
    expect(family.runaway).toHaveBeenCalledWith("guild-1", "user-1");
    const edited = message.edit.mock.calls.at(-1)![0] as ReplyPayload;
    expect(textFromPayload(edited)).toContain("2 family relationships");
  });

  it("bulk cancel does not call service", async () => {
    const { message, collector } = makeMessage();
    const family = { runaway: vi.fn().mockResolvedValue(2) };
    const { ctx } = makeCtx(family, message, []);

    await runawayCommand.execute(ctx);

    const interaction = {
      user: { id: "user-1" },
      customId: "family:runaway:cancel",
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    };
    collector.emit("collect", interaction);
    await flush();

    expect(family.runaway).not.toHaveBeenCalled();
    const edited = message.edit.mock.calls.at(-1)![0] as ReplyPayload;
    expect(textFromPayload(edited)).toContain("Cancelled");
  });

  it("targeted confirm passes target id", async () => {
    const { message, collector } = makeMessage();
    const family = { runaway: vi.fn().mockResolvedValue(1) };
    const { ctx } = makeCtx(family, message, ["<@spouse-1>"]);
    (ctx.guild.members.fetch as any).mockResolvedValue({ id: "spouse-1", displayName: "Spouse" });

    await runawayCommand.execute(ctx);

    const interaction = {
      user: { id: "user-1" },
      customId: "family:runaway:confirm",
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    };
    collector.emit("collect", interaction);
    await flush();

    expect(family.runaway).toHaveBeenCalledWith("guild-1", "user-1", "spouse-1");
    const edited = message.edit.mock.calls.at(-1)![0] as ReplyPayload;
    expect(textFromPayload(edited)).toContain("1 family relationship");
  });

  it("invalid targeted runaway replies Member not found", async () => {
    const { message } = makeMessage();
    const family = { runaway: vi.fn() };
    const { ctx } = makeCtx(family, message, ["<@missing>"]);
    (ctx.guild.members.fetch as any).mockRejectedValue(new Error("nope"));

    await runawayCommand.execute(ctx);

    expect(family.runaway).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith({ content: "Member not found.", ephemeral: true });
  });
});