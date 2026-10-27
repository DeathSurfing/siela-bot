import { describe, expect, it } from "vitest";
import { MessageFlags } from "discord.js";
import { buildDeluluPayload } from "./delulu-ui.js";
import { card, UI_THEMES } from "./ui.js";

function root(payload: ReturnType<typeof card>) {
  return (payload.components![0] as { toJSON(): { type: number; accent_color: number; components: Array<Record<string, unknown>> } }).toJSON();
}

describe("redesigned Discord cards", () => {
  it("keeps a rich card with controls inside Discord's container budget", () => {
    const payload = card({
      theme: "economy", title: "Your wallet", subtitle: "Siela Coins",
      fields: [{ label: "BALANCE", value: "2,450 SC" }, { label: "STREAK", value: "7 days" }],
      body: "Claim your next reward tomorrow.",
    });
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(root(payload).accent_color).toBe(UI_THEMES.economy.color);
    expect(root(payload).components.length).toBeLessThanOrEqual(10);
    expect(JSON.stringify(root(payload))).toContain("2,450 SC");
  });

  it("includes an accessible image backed by an actual PNG attachment", () => {
    const payload = buildDeluluPayload({ bias: "RM", scenario: 'You are at a café. RM says, "Stay for one more song."', nsfw: false, cost: 5, use: 1 });
    const serialized = JSON.stringify(root(payload));
    expect(payload.files).toHaveLength(1);
    const attachment = payload.files![0]!.attachment as Buffer;
    expect(attachment.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(serialized).toContain("attachment://siela-card-hero.png");
    expect(serialized).toContain("RM notices you.");
    expect(serialized.replaceAll("\\", "")).toContain("Stay for one more song.");
    expect(serialized).toContain("5 SC");
    expect(serialized).toContain("Moment 1/4 today");
    expect(root(payload).components.length).toBeLessThanOrEqual(10);
  });

  it("preserves a fallback story with no dialogue delimiter", () => {
    const story = "Jin finds you in the cafeteria and insists on sharing his ramyeon.";
    const serialized = JSON.stringify(root(buildDeluluPayload({ bias: "Jin", scenario: story, nsfw: false, cost: 10, use: 2 })));
    expect(serialized.replaceAll("\\", "")).toContain(story);
    expect(serialized).toContain("Moment 2/4 today");
  });

  it("renders model formatting as story text rather than injected headings", () => {
    const serialized = JSON.stringify(root(buildDeluluPayload({ bias: "V", scenario: "## Surprise **plot twist**", nsfw: false, cost: 5, use: 1 })));
    expect(serialized).toContain("\\\\#\\\\# Surprise");
  });
});
