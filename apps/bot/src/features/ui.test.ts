import { describe, expect, it } from "vitest";
import { MessageFlags } from "discord.js";
import { confirmCard, progressBar } from "./ui.js";

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
