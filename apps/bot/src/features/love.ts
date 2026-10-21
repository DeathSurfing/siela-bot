import { createHash } from "node:crypto";

export interface LoveResult {
  score: number;
  title: string;
  message: string;
}

const LOVE_SALT = "siela-love-v1";

const TIERS: Array<{ min: number; title: string; message: string }> = [
  { min: 0, title: "Ice cold", message: "The stars are not feeling this one." },
  { min: 20, title: "Just friends", message: "There is a spark, but it needs a little kindling." },
  { min: 40, title: "Warm feelings", message: "There is definitely something here." },
  { min: 60, title: "Cute couple", message: "This pair has serious potential." },
  { min: 80, title: "Soulmates", message: "The universe is shipping this one hard." },
  { min: 100, title: "Perfect match", message: "A love story for the history books." },
];

/**
 * Stable pair score. `reroll` is reserved for the future economy feature:
 * incrementing it will produce a different but still constant result.
 */
export function loveScore(guildId: string, firstUserId: string, secondUserId: string, reroll = 0): number {
  const [a, b] = [firstUserId, secondUserId].sort();
  const digest = createHash("sha256")
    .update(`${LOVE_SALT}\u0000${guildId}\u0000${a}\u0000${b}\u0000${reroll}`)
    .digest();
  return digest.readUInt32BE(0) % 101;
}

export function loveResult(guildId: string, firstUserId: string, secondUserId: string, reroll = 0): LoveResult {
  const score = loveScore(guildId, firstUserId, secondUserId, reroll);
  const tier = [...TIERS].reverse().find((entry) => score >= entry.min) ?? TIERS[0]!;
  return { score, title: tier.title, message: tier.message };
}

export function loveBar(score: number): string {
  const filled = Math.round(score / 10);
  return `${"❤️".repeat(filled)}${"🖤".repeat(10 - filled)}`;
}
