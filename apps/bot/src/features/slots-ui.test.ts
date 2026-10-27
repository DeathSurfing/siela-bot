import { describe, it, expect } from "vitest";
import { renderSlotsResult, slotsPayload } from "./slots-ui.js";
import { loadImage } from "@napi-rs/canvas";
describe("slots presentation", () => {
  it("renders all five symbols and both result states", async () => {
    for (const reels of [["🔔", "🍒", "⭐"], ["🍋", "7️⃣", "🍋"], ["7️⃣", "7️⃣", "7️⃣"]]) {
      const image = await loadImage(renderSlotsResult({ reels, wager: 100, payout: reels[0] === "🔔" ? 0 : 160 }));
      expect(image.width).toBe(1040); expect(image.height).toBe(740);
    }
  });
  it("includes readable symbols and unambiguous wager, payout and net result", () => {
    const result = slotsPayload({ reels: ["🔔", "🍒", "⭐"], wager: 100, payout: 0 });
    expect(JSON.stringify(result.components)).toContain("Bell · Cherries · Star. Wager 100 SC. Payout 0 SC. Net -100 SC.");
    expect(result.files).toHaveLength(1);
    expect(JSON.stringify(slotsPayload({ reels: ["🍋", "🍋", "⭐"], wager: 100, payout: 160 }).components)).toContain("Net 60 SC");
  });
});
