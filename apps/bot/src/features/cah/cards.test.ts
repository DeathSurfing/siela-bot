import { describe, expect, it } from "vitest";
import { loadBasePack, validatePack } from "./cards.js";

describe("CAH base card pack", () => {
  it("loads 100 black and 400 white cards", () => {
    const pack = loadBasePack();
    expect(pack.black).toHaveLength(100);
    expect(pack.white).toHaveLength(400);
  });

  it("has unique ids across all cards", () => {
    const pack = loadBasePack();
    const ids = [...pack.black.map((card) => card.id), ...pack.white.map((card) => card.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every black card a blank and pick 1", () => {
    const pack = loadBasePack();
    for (const card of pack.black) {
      expect(card.text).toContain("____");
      expect(card.pick).toBe(1);
    }
  });

  it("has no empty text", () => {
    const pack = loadBasePack();
    for (const card of [...pack.black, ...pack.white]) {
      expect(card.text.trim()).not.toBe("");
      expect(card.id.trim()).not.toBe("");
    }
  });

  it("round-trips through the loader and validates", () => {
    const pack = loadBasePack();
    expect(validatePack(pack)).toEqual([]);
    const again = loadBasePack();
    expect(again).toEqual(pack);
  });
});