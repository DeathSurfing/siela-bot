import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { MessageFlags } from "discord.js";
import { attachPagination, card, confirmCard, progressBar, styleMessage } from "./ui.js";

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

    expect(JSON.stringify(nonOwner.reply.mock.calls[0]![0])).toContain("Only the original user can change pages.");
    expect(nonOwner.reply.mock.calls[0]![0].ephemeral).toBe(true);
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


describe("outgoing message styling", () => {
  it("preserves controls, files, mentions and private delivery", () => {
    const row = { type: 1, components: [{ type: 2, custom_id: "keep:this:id", label: "Continue", style: 1 }] };
    const files = [{ attachment: Buffer.from("image"), name: "image.png" }];
    const mentions = { parse: [] as never[], repliedUser: false };
    const result = styleMessage({ content: "Hello there", components: [row], files, allowedMentions: mentions, ephemeral: true });
    expect(result).not.toHaveProperty("content");
    expect(result.components[1]).toBe(row);
    expect(result.files).toBe(files);
    expect(result.allowedMentions).toBe(mentions);
    expect(result.ephemeral).toBe(true);
    expect(JSON.stringify(result)).toContain("Hello there");
  });
  it("retains welcome image attachments while converting legacy embeds", () => {
    const result = styleMessage({ embeds: [{ title: "Welcome", description: "Make yourself at home", image: { url: "attachment://welcome.png" } }], files: ["welcome.png"] });
    expect(result).not.toHaveProperty("embeds");
    expect(JSON.stringify(result)).toContain("attachment://welcome.png");
    expect(JSON.stringify(result)).toContain("Make yourself at home");
  });
  it("keeps raw content when a ping is requested, since component mentions do not notify", () => {
    const row = { type: 1, components: [{ type: 2, custom_id: "keep:ping:id", label: "Bid", style: 1 }] };
    const rolePing = { content: "New relic up for auction", allowedMentions: { roles: ["456"] }, components: [row] };
    expect(styleMessage(rolePing)).toBe(rolePing);
    expect(rolePing.components[0]).toBe(row);
    const userPing = { content: "Welcome <@123>", allowedMentions: { users: ["123"], parse: [] as never[] } };
    expect(styleMessage(userPing)).toBe(userPing);
    const parsePing = { content: "@everyone game night", allowedMentions: { parse: ["everyone" as const] } };
    expect(styleMessage(parsePing)).toBe(parsePing);
  });

  it("still styles payloads whose mention policy suppresses pings", () => {
    const quiet = { content: "Nothing to notify", allowedMentions: { parse: [] as never[], repliedUser: false } };
    const styled = styleMessage(quiet) as { content?: string; components?: unknown[] };
    expect(styled.content).toBeUndefined();
    expect(Array.isArray(styled.components)).toBe(true);
  });

  it("references caller-supplied image attachments so they render", () => {
    const payload = card({ title: "Family tree", body: "caption", image: { name: "family-tree.png" }, footer: false });
    const json = JSON.stringify((payload.components ?? []).map((component) => (component as any).toJSON()));
    expect(json).toContain("attachment://family-tree.png");
  });

  it("surfaces image files that nothing referenced", () => {
    const file = { name: "family-tree.png", attachment: Buffer.from("png") };
    const styled = styleMessage({ content: "caption", files: [file] }) as { components?: unknown[] };
    const json = JSON.stringify((styled.components ?? []).map((component) => (component as any).toJSON()));
    expect(json).toContain("attachment://family-tree.png");
  });

  it("does not add a second gallery when an embed already shows the image", () => {
    const file = { name: "welcome.png", attachment: Buffer.from("png") };
    const styled = styleMessage({
      embeds: [{ title: "Welcome", image: { url: "attachment://welcome.png" } }],
      files: [file],
    }) as { components?: unknown[] };
    const json = JSON.stringify((styled.components ?? []).map((component) => (component as any).toJSON()));
    expect(json.split("attachment://welcome.png").length - 1).toBe(1);
  });

  it("does not double-wrap rich panels or erase component-only edits", () => {
    const rich = card({ title: "Help", body: "Choose a category" });
    expect(styleMessage(rich)).toBe(rich);
    const clear = { components: [] };
    expect(styleMessage(clear)).toBe(clear);
    expect(JSON.stringify(styleMessage("Birthday time!"))).toContain("Birthday time!");
  });
});

