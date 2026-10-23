import { RELIC_SUBJECTS, RELIC_VARIANTS } from "./catalog.js";
import type {
  RelicAuctionDefaults,
  RelicDropWindow,
  RelicRarity,
  RelicRarityDef,
  RelicRoll,
  RelicStats,
  RelicSubject,
  RelicVariant,
} from "./types.js";

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const RELIC_TIME_ZONE = "Asia/Kolkata";

export const RELIC_RARITIES: Record<RelicRarity, RelicRarityDef> = {
  common: {
    key: "common",
    label: "Common",
    weight: 52,
    weekendWeight: 34,
    color: "#94a3b8",
    glow: "#cbd5e1",
    emoji: "⚪",
    yieldPerDay: 1,
    statRange: [8, 32],
    badge: "COMMON",
  },
  uncommon: {
    key: "uncommon",
    label: "Uncommon",
    weight: 27,
    weekendWeight: 28,
    color: "#22c55e",
    glow: "#86efac",
    emoji: "🟢",
    yieldPerDay: 2,
    statRange: [18, 45],
    badge: "UNCOMMON",
  },
  rare: {
    key: "rare",
    label: "Rare",
    weight: 13,
    weekendWeight: 22,
    color: "#3b82f6",
    glow: "#93c5fd",
    emoji: "🔵",
    yieldPerDay: 4,
    statRange: [30, 60],
    badge: "RARE",
  },
  epic: {
    key: "epic",
    label: "Epic",
    weight: 6,
    weekendWeight: 11,
    color: "#a855f7",
    glow: "#d8b4fe",
    emoji: "🟣",
    yieldPerDay: 7,
    statRange: [42, 72],
    badge: "EPIC",
  },
  legendary: {
    key: "legendary",
    label: "Legendary",
    weight: 1.8,
    weekendWeight: 4,
    color: "#f59e0b",
    glow: "#fcd34d",
    emoji: "🟡",
    yieldPerDay: 12,
    statRange: [55, 85],
    badge: "LEGENDARY",
  },
  mythic: {
    key: "mythic",
    label: "Mythic",
    weight: 0.2,
    weekendWeight: 1,
    color: "#f43f5e",
    glow: "#fda4af",
    emoji: "🔴",
    yieldPerDay: 25,
    statRange: [68, 98],
    badge: "MYTHIC",
  },
};

export const RELIC_RARITY_ORDER: RelicRarity[] = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
  "mythic",
];

export const RELIC_AUCTION_DEFAULTS: RelicAuctionDefaults = {
  startHourIst: 16,
  durationMinutes: 60,
  startingBid: 25,
  minIncrement: 10,
};

export const RELIC_TRADE_TTL_MS = 10 * 60 * 1000;
export const RELIC_YIELD_CAP_DAYS = 30;

export function relicSerialLabel(serial: number): string {
  return `#${String(serial).padStart(4, "0")}`;
}

export function relicRarityRank(rarity: RelicRarity): number {
  return RELIC_RARITY_ORDER.indexOf(rarity);
}

export function relicRarityLabel(rarity: RelicRarity): string {
  return RELIC_RARITIES[rarity].label;
}

export function isRelicGenesis(serial: number): boolean {
  return serial > 0 && serial <= 10;
}

/** Passive coins per day for a card. Genesis cards (serial 1-10) pay double. */
export function relicYieldPerDay(rarity: RelicRarity, serial: number): number {
  const base = RELIC_RARITIES[rarity].yieldPerDay;
  return isRelicGenesis(serial) ? base * 2 : base;
}

export function hashRelicSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Small, fast, deterministic PRNG. */
export function createRelicRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted<T>(rng: () => number, entries: Array<{ value: T; weight: number }>): T {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (total <= 0) return entries[0]!.value;
  let roll = rng() * total;
  for (const entry of entries) {
    roll -= Math.max(0, entry.weight);
    if (roll <= 0) return entry.value;
  }
  return entries[entries.length - 1]!.value;
}

export function pickRelicRarity(rng: () => number, weekend: boolean): RelicRarity {
  return pickWeighted(
    rng,
    RELIC_RARITY_ORDER.map((rarity) => ({
      value: rarity,
      weight: weekend ? RELIC_RARITIES[rarity].weekendWeight : RELIC_RARITIES[rarity].weight,
    })),
  );
}

export function pickRelicSubject(rng: () => number, excludeKeys: ReadonlySet<string> = new Set()): RelicSubject {
  const pool = RELIC_SUBJECTS.length ? RELIC_SUBJECTS : [];
  if (!pool.length) throw new Error("Relic subject catalog is empty");
  const preferred = pool.filter((subject) => !excludeKeys.has(subject.key));
  const candidates = preferred.length ? preferred : pool;
  return candidates[Math.floor(rng() * candidates.length)] ?? candidates[0]!;
}

export function pickRelicVariant(rng: () => number): RelicVariant {
  return pickWeighted(
    rng,
    RELIC_VARIANTS.map((variant) => ({ value: variant, weight: variant.weight })),
  );
}

function clampStat(value: number): number {
  return Math.max(1, Math.min(99, Math.round(value)));
}

export function rollRelicStats(
  rarity: RelicRarity,
  rng: () => number,
  variant: RelicVariant,
  genesis: boolean,
): RelicStats {
  const [min, max] = RELIC_RARITIES[rarity].statRange;
  const base = (stat: "power" | "chaos" | "luck" | "aura"): number => {
    const roll = min + Math.floor(rng() * (max - min + 1));
    const bonus = variant.bonus[stat] ?? 0;
    return clampStat(roll + bonus + (genesis ? 5 : 0));
  };
  const power = base("power");
  const chaos = base("chaos");
  const luck = base("luck");
  const aura = base("aura");
  const rating = Math.round(power * 0.35 + chaos * 0.25 + luck * 0.2 + aura * 0.2);
  return { power, chaos, luck, aura, rating };
}

export function rollRelic(input: {
  serial: number;
  seed: number;
  weekend: boolean;
  rarity?: RelicRarity;
  subject?: RelicSubject;
  variant?: RelicVariant;
  excludeSubjectKeys?: ReadonlySet<string>;
}): RelicRoll {
  const rng = createRelicRng(input.seed);
  const rarity = input.rarity ?? pickRelicRarity(rng, input.weekend);
  const subject = input.subject ?? pickRelicSubject(rng, input.excludeSubjectKeys);
  const variant = input.variant ?? pickRelicVariant(rng);
  const genesis = isRelicGenesis(input.serial);
  const stats = rollRelicStats(rarity, rng, variant, genesis);
  return {
    subject,
    variant,
    rarity,
    stats,
    name: subject.name,
    serial: input.serial,
    seed: input.seed,
    isGenesis: genesis,
  };
}

export interface IstDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
  dateKey: string;
}

export function istDateParts(date: Date = new Date()): IstDateParts {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  return {
    year,
    month,
    day,
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
    dateKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

export function isRelicWeekend(date: Date = new Date()): boolean {
  const weekday = istDateParts(date).weekday;
  return weekday === 0 || weekday === 6;
}

/** Today's (IST) auction window. Returns the window even if it already passed. */
export function relicDropWindow(
  date: Date = new Date(),
  defaults: RelicAuctionDefaults = RELIC_AUCTION_DEFAULTS,
): RelicDropWindow {
  const parts = istDateParts(date);
  const start = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, defaults.startHourIst, 0) - IST_OFFSET_MS,
  );
  const end = new Date(start.getTime() + Math.max(1, defaults.durationMinutes) * 60_000);
  return { start, end, dateKey: parts.dateKey };
}

export function nextRelicDropAt(
  now: Date = new Date(),
  defaults: RelicAuctionDefaults = RELIC_AUCTION_DEFAULTS,
): Date {
  const window = relicDropWindow(now, defaults);
  if (window.start.getTime() > now.getTime()) return window.start;
  return new Date(window.start.getTime() + DAY_MS);
}

export function nextRelicBid(
  currentBid: number | null,
  startingBid: number,
  minIncrement: number,
  steps = 1,
): number {
  if (currentBid === null) return startingBid;
  return currentBid + Math.max(1, minIncrement) * Math.max(1, steps);
}

export function isValidRelicBid(
  amount: number,
  currentBid: number | null,
  startingBid: number,
  minIncrement: number,
): boolean {
  if (!Number.isInteger(amount) || amount <= 0) return false;
  return amount >= nextRelicBid(currentBid, startingBid, minIncrement);
}

export function relicRatingSum(stats: RelicStats): number {
  return stats.power + stats.chaos + stats.luck + stats.aura;
}
