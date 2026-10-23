export type RelicRarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic";

export type RelicCategory = "internet" | "gaming" | "anime" | "cinema" | "music" | "cursed" | "wholesome";

export type RelicSigil =
  | "star"
  | "bolt"
  | "heart"
  | "skull"
  | "crown"
  | "ghost"
  | "flame"
  | "spiral"
  | "eye"
  | "shard";

export type RelicFoil = "none" | "holo" | "prism" | "gold" | "obsidian";

export interface RelicRarityDef {
  key: RelicRarity;
  label: string;
  /** Weight on Monday-Friday, out of 100. */
  weight: number;
  /** Weight on Saturday and Sunday, out of 100. */
  weekendWeight: number;
  color: string;
  glow: string;
  emoji: string;
  /** Passive SC per day while held. */
  yieldPerDay: number;
  /** Inclusive stat range for a freshly rolled card. */
  statRange: readonly [number, number];
  badge: string;
}

export interface RelicSubject {
  /** Stable lowercase slug. */
  key: string;
  /** Card title, 2-40 characters. */
  name: string;
  emoji: string;
  category: RelicCategory;
  sigil: RelicSigil;
  /** One sentence of flavour, roughly 60-140 characters. */
  lore: string;
  /** Three hex colours used by the art renderer. */
  palette: readonly [string, string, string];
}

export interface RelicVariant {
  /** Stable lowercase slug. */
  key: string;
  name: string;
  /** Short finish description shown on the card. */
  blurb: string;
  /** Relative selection weight out of 100 across all variants. */
  weight: number;
  foil: RelicFoil;
  bonus: Partial<Record<"power" | "chaos" | "luck" | "aura", number>>;
}

export interface RelicStats {
  power: number;
  chaos: number;
  luck: number;
  aura: number;
  rating: number;
}

export interface RelicRoll {
  subject: RelicSubject;
  variant: RelicVariant;
  rarity: RelicRarity;
  stats: RelicStats;
  name: string;
  serial: number;
  seed: number;
  isGenesis: boolean;
}

export interface RelicDropWindow {
  start: Date;
  end: Date;
  dateKey: string;
}

export interface RelicAuctionDefaults {
  startHourIst: number;
  durationMinutes: number;
  startingBid: number;
  minIncrement: number;
}
