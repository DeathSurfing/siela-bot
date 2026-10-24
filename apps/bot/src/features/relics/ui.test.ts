import { describe, expect, it } from "vitest";
import { MessageFlags } from "discord.js";
import { buildInventoryPayload, type InventoryStats } from "./ui.js";

describe("relic inventory UI", () => {
  it("uses neutral empty-vault copy and unique inventory ids", () => {
    const payload = buildInventoryPayload({
      userId: "123",
      displayName: "Test",
      entries: [],
      total: 0,
      page: 1,
      pages: 3,
      stats: {
        cards: 0,
        rating: 0,
        yieldPerDay: 0,
        auctionWins: 0,
        rarityCounts: {
          common: 0,
          uncommon: 0,
          rare: 0,
          epic: 0,
          legendary: 0,
          mythic: 0,
        },
      } satisfies InventoryStats,
      featured: null,
      featuredArt: null,
    });
    const json = JSON.stringify(payload.components);
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(json).toContain("This vault is empty.");
    const ids = json.match(/relics:inv:[^"]+/g) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("relics:inv:123:1");
  });
});