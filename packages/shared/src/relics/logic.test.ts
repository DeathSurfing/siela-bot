import { describe, expect, it } from "vitest";
import { RELIC_SUBJECTS, RELIC_VARIANTS } from "./catalog.js";
import {
  RELIC_RARITIES,
  RELIC_RARITY_ORDER,
  createRelicRng,
  isRelicWeekend,
  isValidRelicBid,
  istDateParts,
  nextRelicBid,
  nextRelicDropAt,
  relicDropWindow,
  relicSerialLabel,
  relicYieldPerDay,
  rollRelic,
  rollRelicStats,
} from "./logic.js";
import type { RelicCategory, RelicSigil } from "./types.js";

const CATEGORIES: readonly RelicCategory[] = [
  "internet",
  "gaming",
  "anime",
  "cinema",
  "music",
  "cursed",
  "wholesome",
];

const SIGILS: readonly RelicSigil[] = [
  "star",
  "bolt",
  "heart",
  "skull",
  "crown",
  "ghost",
  "flame",
  "spiral",
  "eye",
  "shard",
];

const STAT_KEYS = ["power", "chaos", "luck", "aura"] as const;

const EXPECTED_VARIANT_KEYS = [
  "standard",
  "holo",
  "reverse-holo",
  "prismatic",
  "gilded",
  "obsidian",
  "misprint",
  "first-edition",
];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

describe("relic catalog", () => {
  it("has at least 72 subjects", () => {
    expect(RELIC_SUBJECTS.length).toBeGreaterThanOrEqual(72);
  });

  it("uses unique keys and names", () => {
    const keys = RELIC_SUBJECTS.map((subject) => subject.key);
    const names = RELIC_SUBJECTS.map((subject) => subject.name);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(names).size).toBe(names.length);

    for (const subject of RELIC_SUBJECTS) {
      expect(subject.key).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(subject.name.length).toBeGreaterThanOrEqual(2);
      expect(subject.name.length).toBeLessThanOrEqual(40);
      expect(subject.emoji.trim().length).toBeGreaterThan(0);
    }
  });

  it("keeps lore short, single-sentence, and quote-free", () => {
    for (const subject of RELIC_SUBJECTS) {
      expect(subject.lore.length).toBeGreaterThan(0);
      expect(subject.lore.length).toBeGreaterThanOrEqual(55);
      expect(subject.lore.length).toBeLessThanOrEqual(150);
      expect(subject.lore.endsWith(".")).toBe(true);
      expect(subject.lore).not.toContain("\n");
      expect(subject.lore).not.toContain('"');
      expect(subject.lore.split(".").length).toBe(2);
    }
  });

  it("has valid three-colour palettes", () => {
    for (const subject of RELIC_SUBJECTS) {
      expect(subject.palette).toHaveLength(3);
      for (const color of subject.palette) {
        expect(color).toMatch(HEX_COLOR);
      }
    }
  });

  it("uses valid sigils and categories with broad coverage", () => {
    const seenSigils = new Set<RelicSigil>();
    const seenCategories = new Set<RelicCategory>();

    for (const subject of RELIC_SUBJECTS) {
      expect(SIGILS).toContain(subject.sigil);
      expect(CATEGORIES).toContain(subject.category);
      seenSigils.add(subject.sigil);
      seenCategories.add(subject.category);
    }

    expect(seenSigils.size).toBe(SIGILS.length);
    expect(seenCategories.size).toBe(CATEGORIES.length);

    for (const category of CATEGORIES) {
      const count = RELIC_SUBJECTS.filter((subject) => subject.category === category).length;
      expect(count).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("relic variants", () => {
  it("contains exactly the eight finishes", () => {
    expect(RELIC_VARIANTS).toHaveLength(8);
    const keys = RELIC_VARIANTS.map((variant) => variant.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([...EXPECTED_VARIANT_KEYS].sort());
  });

  it("has weights summing to 100", () => {
    const total = RELIC_VARIANTS.reduce((sum, variant) => sum + variant.weight, 0);
    expect(total).toBeCloseTo(100, 10);
  });

  it("has short blurbs and positive bonuses on known stats", () => {
    for (const variant of RELIC_VARIANTS) {
      expect(variant.blurb.length).toBeGreaterThan(0);
      expect(variant.blurb.length).toBeLessThan(80);

      for (const [stat, bonus] of Object.entries(variant.bonus)) {
        expect(STAT_KEYS).toContain(stat);
        expect(typeof bonus).toBe("number");
        expect(bonus).toBeGreaterThan(0);
      }
    }
  });
});

describe("rarity weights", () => {
  it("sums weekday weights to 100", () => {
    const total = RELIC_RARITY_ORDER.reduce(
      (sum, rarity) => sum + RELIC_RARITIES[rarity].weight,
      0,
    );
    expect(total).toBeCloseTo(100, 10);
  });

  it("sums weekend weights to 100", () => {
    const total = RELIC_RARITY_ORDER.reduce(
      (sum, rarity) => sum + RELIC_RARITIES[rarity].weekendWeight,
      0,
    );
    expect(total).toBeCloseTo(100, 10);
  });
});

describe("rollRelic", () => {
  it("is deterministic for the same seed", () => {
    const input = { serial: 777, seed: 20_261_023, weekend: false };
    expect(rollRelic(input)).toEqual(rollRelic(input));
  });

  it("produces different rolls across seeds", () => {
    const signatures = Array.from({ length: 20 }, (_, index) => {
      const roll = rollRelic({ serial: 100 + index, seed: 1_000 + index, weekend: false });
      return [
        roll.rarity,
        roll.stats.power,
        roll.stats.chaos,
        roll.stats.luck,
        roll.stats.aura,
      ].join(":");
    });

    expect(new Set(signatures).size).toBeGreaterThan(1);
  });

  it("clamps every stat and rating to 1-99", () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const roll = rollRelic({ serial: 500, seed, weekend: seed % 2 === 0 });
      for (const stat of STAT_KEYS) {
        expect(roll.stats[stat]).toBeGreaterThanOrEqual(1);
        expect(roll.stats[stat]).toBeLessThanOrEqual(99);
      }
      expect(roll.stats.rating).toBeGreaterThanOrEqual(1);
      expect(roll.stats.rating).toBeLessThanOrEqual(99);
    }
  });

  it("respects the mythic stat range without bonuses", () => {
    const standard = RELIC_VARIANTS.find((variant) => variant.key === "standard");
    expect(standard).toBeDefined();

    for (let seed = 1; seed <= 50; seed += 1) {
      const stats = rollRelicStats("mythic", createRelicRng(seed * 7_919), standard!, false);
      for (const stat of STAT_KEYS) {
        expect(stats[stat]).toBeGreaterThanOrEqual(68);
        expect(stats[stat]).toBeLessThanOrEqual(98);
      }
      expect(stats.rating).toBeGreaterThanOrEqual(68);
      expect(stats.rating).toBeLessThanOrEqual(98);
    }
  });

  it("adds exactly 5 to genesis stats before clamping", () => {
    const standard = RELIC_VARIANTS.find((variant) => variant.key === "standard");

    for (let seed = 1; seed <= 50; seed += 1) {
      const normal = rollRelicStats("common", createRelicRng(seed), standard!, false);
      const genesis = rollRelicStats("common", createRelicRng(seed), standard!, true);
      for (const stat of STAT_KEYS) {
        expect(genesis[stat]).toBe(normal[stat] + 5);
      }
    }
  });

  it("keeps genesis rolls above the rarity minimum plus bonuses", () => {
    const subject = RELIC_SUBJECTS[0]!;
    const gilded = RELIC_VARIANTS.find((variant) => variant.key === "gilded");
    expect(gilded).toBeDefined();

    for (let seed = 1; seed <= 50; seed += 1) {
      const roll = rollRelic({
        serial: 7,
        seed,
        weekend: true,
        subject,
        variant: gilded!,
      });

      expect(roll.isGenesis).toBe(true);
      expect(roll.subject.key).toBe(subject.key);
      expect(roll.variant.key).toBe("gilded");

      const minimum = RELIC_RARITIES[roll.rarity].statRange[0];
      for (const stat of STAT_KEYS) {
        const expectedMinimum = minimum + (gilded!.bonus[stat] ?? 0) + 5;
        expect(roll.stats[stat]).toBeGreaterThanOrEqual(expectedMinimum);
      }
    }
  });
});

describe("serial labels", () => {
  it("pads to four digits", () => {
    expect(relicSerialLabel(42)).toBe("#0042");
    expect(relicSerialLabel(9_999)).toBe("#9999");
  });
});

describe("bidding", () => {
  it("starts at the opening bid and increments correctly", () => {
    expect(nextRelicBid(null, 25, 10)).toBe(25);
    expect(nextRelicBid(100, 25, 10)).toBe(110);
    expect(nextRelicBid(100, 25, 10, 3)).toBe(130);
  });

  it("validates integer bids at or above the next minimum", () => {
    expect(isValidRelicBid(25, null, 25, 10)).toBe(true);
    expect(isValidRelicBid(24, null, 25, 10)).toBe(false);
    expect(isValidRelicBid(110, 100, 25, 10)).toBe(true);
    expect(isValidRelicBid(109, 100, 25, 10)).toBe(false);
    expect(isValidRelicBid(110.5, 100, 25, 10)).toBe(false);
    expect(isValidRelicBid(0, null, 25, 10)).toBe(false);
    expect(isValidRelicBid(-10, 100, 25, 10)).toBe(false);
  });
});

describe("IST drop timing", () => {
  it("derives the IST date key and clock", () => {
    const parts = istDateParts(new Date("2026-10-24T10:30:00.000Z"));
    expect(parts.dateKey).toBe("2026-10-24");
    expect(parts.hour).toBe(16);
    expect(parts.minute).toBe(0);
    expect(parts.weekday).toBe(6);
  });

  it("detects weekend days in IST", () => {
    expect(isRelicWeekend(new Date("2026-10-24T10:30:00.000Z"))).toBe(true);
    expect(isRelicWeekend(new Date("2026-10-25T10:30:00.000Z"))).toBe(true);
    expect(isRelicWeekend(new Date("2026-10-23T10:30:00.000Z"))).toBe(false);
    expect(isRelicWeekend(new Date("2026-10-23T20:00:00.000Z"))).toBe(true);
  });

  it("builds the 16:00 IST auction window", () => {
    const window = relicDropWindow(new Date("2026-10-23T10:30:00.000Z"));
    expect(window.dateKey).toBe("2026-10-23");
    expect(window.start.toISOString()).toBe("2026-10-23T10:30:00.000Z");
    expect(window.end.toISOString()).toBe("2026-10-23T11:30:00.000Z");
  });

  it("moves to tomorrow once the window has started", () => {
    const before = nextRelicDropAt(new Date("2026-10-23T10:29:59.000Z"));
    expect(before.toISOString()).toBe("2026-10-23T10:30:00.000Z");

    const atStart = nextRelicDropAt(new Date("2026-10-23T10:30:00.000Z"));
    expect(atStart.toISOString()).toBe("2026-10-24T10:30:00.000Z");

    const after = nextRelicDropAt(new Date("2026-10-23T11:45:00.000Z"));
    expect(after.toISOString()).toBe("2026-10-24T10:30:00.000Z");
  });
});

describe("genesis yield", () => {
  it("doubles the daily yield for serials 1-10", () => {
    expect(relicYieldPerDay("rare", 5)).toBe(8);
    expect(relicYieldPerDay("rare", 10)).toBe(8);
    expect(relicYieldPerDay("rare", 50)).toBe(4);
    expect(relicYieldPerDay("rare", 11)).toBe(4);
  });
});
