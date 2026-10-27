import { describe, expect, it, vi } from "vitest";
import type { ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import type { CommandContext, Services } from "../../framework/types.js";
import { deluluCommand, handleDeluluSetup } from "./delulu.js";
import { BTS_MEMBERS } from "@siela/shared";

function makeServices() {
  return {
    bias: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue({}) },
    economy: {
      countDeluluUsesToday: vi.fn().mockResolvedValue(0),
      spend: vi.fn().mockResolvedValue(undefined),
      award: vi.fn().mockResolvedValue(undefined),
    },
    delulu: { generate: vi.fn().mockResolvedValue("A fictional scenario.") },
    audit: { log: vi.fn().mockResolvedValue(undefined) },
  };
}

function makeContext(services: ReturnType<typeof makeServices>, slash = true) {
  return {
    guild: { id: "guild-1" }, author: { id: "user-1" },
    source: slash ? "slash" : "prefix", args: [], services,
    interaction: slash ? {
      isChatInputCommand: () => true,
      options: { getBoolean: () => false },
      showModal: vi.fn().mockResolvedValue(undefined),
    } : undefined,
    reply: vi.fn().mockResolvedValue(null),
    defer: vi.fn().mockResolvedValue(undefined),
    edit: vi.fn().mockResolvedValue(null),
  } as unknown as CommandContext;
}

function makeInteraction(options: { button?: boolean; owner?: string; mode?: string; timestamp?: number; bias?: string; wrecker?: string } = {}) {
  return {
    customId: `delulu:setup:${options.button ? "open" : "submit"}:${options.owner ?? "user-1"}:${options.mode ?? "sfw"}:${options.timestamp ?? Date.now()}`,
    guild: { id: "guild-1" }, user: { id: "user-1" },
    fields: { getStringSelectValues: (name: string) => [name === "bias" ? options.bias ?? "Jungkook" : options.wrecker ?? "J-Hope"] },
    isButton: () => !!options.button, isModalSubmit: () => !options.button,
    showModal: vi.fn().mockResolvedValue(undefined),
    message: { edit: vi.fn().mockResolvedValue(undefined) },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(null),
  };
}

async function submit(services: ReturnType<typeof makeServices>, options: Parameters<typeof makeInteraction>[0] = {}) {
  const interaction = makeInteraction(options);
  await handleDeluluSetup(interaction as unknown as ModalSubmitInteraction, services as unknown as Services);
  return interaction;
}

describe("Delulu first-use bias setup", () => {
  it("opens a slash-command modal before charging or generating", async () => {
    const services = makeServices();
    const ctx = makeContext(services);
    await deluluCommand.execute(ctx);
    const modal = (ctx.interaction!.showModal as ReturnType<typeof vi.fn>).mock.calls[0]![0].toJSON();
    expect(modal.custom_id).toContain("delulu:setup:submit:user-1:sfw:");
    expect(modal.components).toHaveLength(2);
    for (const label of modal.components) {
      expect(label.type).toBe(18);
      expect(label.component.type).toBe(3);
      expect(label.component.required).toBe(true);
      expect(label.component.min_values).toBe(1);
      expect(label.component.max_values).toBe(1);
      expect(label.component.options.map((option: { value: string }) => option.value)).toEqual([...BTS_MEMBERS]);
    }
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(ctx.defer).not.toHaveBeenCalled();
    expect(services.economy.spend).not.toHaveBeenCalled();
    expect(services.delulu.generate).not.toHaveBeenCalled();
  });

  it("offers a setup button for prefix commands", async () => {
    const services = makeServices();
    const ctx = makeContext(services, false);
    await deluluCommand.execute(ctx);
    const payload = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(payload.components[0].toJSON().components[0].custom_id).toContain("delulu:setup:open:user-1:sfw:");
    expect(services.economy.spend).not.toHaveBeenCalled();
  });

  it("opens the prefix modal and disables the old setup button", async () => {
    const services = makeServices();
    const interaction = makeInteraction({ button: true });
    await handleDeluluSetup(interaction as unknown as ButtonInteraction, services as unknown as Services);
    expect(interaction.showModal).toHaveBeenCalledOnce();
    expect(JSON.stringify(interaction.message.edit.mock.calls[0]![0])).toContain("Bias setup opened");
    expect(services.bias.set).not.toHaveBeenCalled();
  });

  it("saves normalized choices and generates immediately, charging once", async () => {
    const services = makeServices();
    const interaction = await submit(services);
    expect(interaction.deferReply).toHaveBeenCalledOnce();
    expect(services.bias.set).toHaveBeenCalledWith("guild-1", "user-1", "Jungkook", "J-Hope");
    expect(services.economy.spend).toHaveBeenCalledOnce();
    expect(services.economy.spend).toHaveBeenCalledWith("guild-1", "user-1", 5, "delulu", expect.any(String));
    expect(services.delulu.generate).toHaveBeenCalledWith("Jungkook", false);
    expect(interaction.editReply).toHaveBeenCalledOnce();
  });

  it("rejects invalid or identical members without saving or charging and offers retry", async () => {
    for (const options of [{ bias: "unknown" }, { bias: "jk", wrecker: "Jungkook" }]) {
      const services = makeServices();
      const interaction = await submit(services, options);
      expect(services.bias.set).not.toHaveBeenCalled();
      expect(services.economy.spend).not.toHaveBeenCalled();
      expect(interaction.reply.mock.calls[0]![0].ephemeral).toBe(true);
      expect(interaction.reply.mock.calls[0]![0].components).toHaveLength(2);
    }
  });

  it("rejects another user's setup", async () => {
    const services = makeServices();
    const interaction = await submit(services, { owner: "someone-else" });
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    expect(services.bias.set).not.toHaveBeenCalled();
    expect(services.economy.spend).not.toHaveBeenCalled();
  });

  it("rejects expired setup submissions", async () => {
    const services = makeServices();
    const interaction = await submit(services, { timestamp: Date.now() - 6 * 60 * 1000 });
    expect(JSON.stringify(interaction.reply.mock.calls[0]![0])).toContain("expired");
    expect(services.bias.set).not.toHaveBeenCalled();
  });

  it("enforces the daily limit after saving the bias", async () => {
    const services = makeServices();
    services.economy.countDeluluUsesToday.mockResolvedValue(4);
    const interaction = await submit(services);
    expect(services.bias.set).toHaveBeenCalledOnce();
    expect(services.economy.spend).not.toHaveBeenCalled();
    expect(JSON.stringify(interaction.editReply.mock.calls[0]![0])).toContain("Daily delulu limit reached");
  });

  it("keeps the saved bias when the user cannot afford generation", async () => {
    const services = makeServices();
    services.economy.spend.mockRejectedValue(new Error("INSUFFICIENT_FUNDS"));
    const interaction = await submit(services);
    expect(services.bias.set).toHaveBeenCalledOnce();
    expect(services.delulu.generate).not.toHaveBeenCalled();
    expect(JSON.stringify(interaction.editReply.mock.calls[0]![0])).toContain("You need 5 SC");
  });

  it("refunds a failed generation through the existing payment flow", async () => {
    const services = makeServices();
    services.delulu.generate.mockRejectedValue(new Error("model unavailable"));
    const interaction = await submit(services);
    expect(services.economy.award).toHaveBeenCalledWith("guild-1", "user-1", 5, "delulu_refund", expect.stringContaining(":refund"));
    expect(JSON.stringify(interaction.editReply.mock.calls[0]![0])).toContain("refunded");
  });

  it("skips setup when a saved bias already exists", async () => {
    const services = makeServices();
    services.bias.get.mockResolvedValue({ bias: "Jin" } as never);
    const ctx = makeContext(services);
    await deluluCommand.execute(ctx);
    expect(ctx.interaction!.showModal).not.toHaveBeenCalled();
    expect(services.bias.set).not.toHaveBeenCalled();
    expect(services.delulu.generate).toHaveBeenCalledWith("Jin", false);
  });
});
