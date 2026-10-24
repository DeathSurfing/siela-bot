import { existsSync, readFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface CahBlackCard {
  id: string;
  text: string;
  pick: 1;
}

export interface CahWhiteCard {
  id: string;
  text: string;
}

export interface CahPack {
  pack: string;
  black: CahBlackCard[];
  white: CahWhiteCard[];
}

const EXPECTED_BLACK = 100;
const EXPECTED_WHITE = 400;

function resolveBasePackPath(override?: string): string {
  if (override) return override;
  const candidates = [
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "assets", "cah", "base.json"),
    join(process.cwd(), "assets", "cah", "base.json"),
    join(process.cwd(), "apps", "bot", "assets", "cah", "base.json"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0] ?? "";
}

export function validatePack(pack: unknown): string[] {
  const errors: string[] = [];
  if (!pack || typeof pack !== "object" || Array.isArray(pack)) {
    errors.push("pack must be an object");
    return errors;
  }
  const record = pack as Record<string, unknown>;
  const black = Array.isArray(record.black) ? record.black : [];
  const white = Array.isArray(record.white) ? record.white : [];
  if (!Array.isArray(record.black)) errors.push("black must be an array");
  if (!Array.isArray(record.white)) errors.push("white must be an array");
  if (black.length !== EXPECTED_BLACK) {
    errors.push(`expected ${EXPECTED_BLACK} black cards, got ${black.length}`);
  }
  if (white.length !== EXPECTED_WHITE) {
    errors.push(`expected ${EXPECTED_WHITE} white cards, got ${white.length}`);
  }

  const ids = new Set<string>();
  for (const entry of black) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push("black entry must be an object");
      continue;
    }
    const card = entry as Record<string, unknown>;
    const id = typeof card.id === "string" ? card.id : "";
    if (!id) errors.push("black card missing id");
    else if (ids.has(id)) errors.push(`duplicate id ${id}`);
    else ids.add(id);
    if (typeof card.text !== "string" || card.text.trim() === "") {
      errors.push(`black ${id || "<unknown>"} has empty text`);
    } else if (!card.text.includes("____")) {
      errors.push(`black ${id || "<unknown>"} missing blank`);
    }
    if (card.pick !== 1) {
      errors.push(`black ${id || "<unknown>"} pick must be 1`);
    }
  }
  for (const entry of white) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push("white entry must be an object");
      continue;
    }
    const card = entry as Record<string, unknown>;
    const id = typeof card.id === "string" ? card.id : "";
    if (!id) errors.push("white card missing id");
    else if (ids.has(id)) errors.push(`duplicate id ${id}`);
    else ids.add(id);
    if (typeof card.text !== "string" || card.text.trim() === "") {
      errors.push(`white ${id || "<unknown>"} has empty text`);
    }
  }
  return errors;
}

export function loadBasePack(path?: string): CahPack {
  const resolved = resolveBasePackPath(path);
  const raw = readFileSync(resolved, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const errors = validatePack(parsed);
  if (errors.length > 0) {
    throw new Error(`invalid cah pack: ${errors.join("; ")}`);
  }
  return parsed as CahPack;
}

export function shuffleDeck<T>(cards: readonly T[], rng?: () => number): T[] {
  const deck = [...cards];
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swap = rng ? Math.floor(rng() * (index + 1)) : randomInt(0, index + 1);
    const clamped = Math.max(0, Math.min(index, swap));
    [deck[index], deck[clamped]] = [deck[clamped]!, deck[index]!];
  }
  return deck;
}

export function shuffleCards<T>(cards: readonly T[], rng?: () => number): T[] {
  return shuffleDeck(cards, rng);
}

export function shuffle<T>(cards: readonly T[], rng?: () => number): T[] {
  return shuffleDeck(cards, rng);
}

export function drawCards<T>(deck: T[], count: number): T[] {
  if (count <= 0) return [];
  return deck.splice(0, count);
}