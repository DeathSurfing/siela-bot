import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { MessageFlags } from "discord.js";
import { attachPagination, card, confirmCard, progressBar } from "./ui.js";

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

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("UI primitives", () => {
  it("builds a Components V2 payload", () => {
    const payload = confirmCard({
      title: "Delete channel?",
      body: "This cannot be undone.",
      confirmId: "confirm",
      cancelId: "cancel",
    });
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    const component = payload.components?.[0] as { toJSON(): unknown } | undefined;
    expect(component?.toJSON()).toMatchObject({
      type: 17,
      components: expect.arrayContaining([
        expect.objectContaining({ type: 10, content: "## Delete channel?" }),
        expect.objectContaining({ type: 10, content: "This cannot be undone." }),
      ]),
    });
  });

  it("renders progress bars", () => {
    expect(progressBar(0, 100, 10)).toBe("▱▱▱▱▱▱▱▱▱▱");
    expect(progressBar(50, 100, 10)).toBe("▰▰▰▰▰▱▱▱▱▱");
    expect(progressBar(100, 100, 10)).toBe("▰▰▰▰▰▰▰▰▰▰");
  });
});

describe("attachPagination", () => {
  it("acknowledges non-owner clicks without updating", async () => {
    const { message, collector } = makeMessage();
    const render = vi.fn((page: number, disabled?: boolean) =>
      card({ title: `Page ${page}`, body: disabled ? "disabled" : "active" }),
    );
    attachPagination(message, "owner", 1, render);

    const nonOwner = {
      user: { id: "other" },
      customId: "lb:page:2",
      reply: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    };
    collector.emit("collect", nonOwner);
    await flush();

    expect(nonOwner.reply).toHaveBeenCalledWith({ content: "Only the original user can change pages.", ephemeral: true });
    expect(nonOwner.update).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();

    const owner = {
      user: { id: "owner" },
      customId: "lb:page:2",
      reply: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    };
    collector.emit("collect", owner);
    await flush();

    expect(owner.update).toHaveBeenCalled();
    expect(render).toHaveBeenCalledWith(2, false);

    collector.emit("end", [], "time");
    expect(message.edit).toHaveBeenCalled();
    const lastEdit = message.edit.mock.calls.at(-1)![0];
    expect((lastEdit as any)?.components).toBeDefined();
  });
});
