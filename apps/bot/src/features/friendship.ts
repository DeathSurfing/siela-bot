import { and, desc, eq, sql } from "drizzle-orm";
import { friendshipLevels, type Database, type FriendshipLevelRow } from "@siela/db";
import type { Logger } from "../lib/logger.js";
import { UserError } from "../lib/errors.js";

export interface FriendshipTier {
  min: number;
  label: string;
  emoji: string;
}

export const FRIENDSHIP_TIERS: FriendshipTier[] = [
  { min: 0, label: "Strangers", emoji: "👋" },
  { min: 1, label: "Acquaintances", emoji: "💫" },
  { min: 5, label: "Buddies", emoji: "🤝" },
  { min: 10, label: "Besties", emoji: "💞" },
  { min: 25, label: "Soulmates", emoji: "💖" },
  { min: 50, label: "Legendary Duo", emoji: "👑" },
  { min: 100, label: "Destiny Duo", emoji: "✨" },
];

export function friendshipTier(xp: number): FriendshipTier {
  return [...FRIENDSHIP_TIERS].reverse().find((tier) => xp >= tier.min) ?? FRIENDSHIP_TIERS[0]!;
}

export function friendshipProgress(xp: number): { current: number; next: number | null; percent: number } {
  const tier = friendshipTier(xp);
  const next = FRIENDSHIP_TIERS.find((entry) => entry.min > tier.min)?.min ?? null;
  if (next === null) return { current: xp, next: null, percent: 100 };
  const span = next - tier.min;
  const progress = Math.max(0, Math.min(span, xp - tier.min));
  return { current: xp, next, percent: Math.round((progress / span) * 100) };
}

export class FriendshipService {
  constructor(private readonly db: Database, private readonly logger: Logger) {}

  private key(a: string, b: string): [string, string] {
    return a < b ? [a, b] : [b, a];
  }

  async addXp(guildId: string, firstUserId: string, secondUserId: string, amount: number): Promise<void> {
    if (amount <= 0 || firstUserId === secondUserId) return;
    const [userA, userB] = this.key(firstUserId, secondUserId);
    try {
      await this.db
        .insert(friendshipLevels)
        .values({ guildId, userA, userB, xp: amount, lastActivityAt: new Date() })
        .onConflictDoUpdate({
          target: [friendshipLevels.guildId, friendshipLevels.userA, friendshipLevels.userB],
          set: {
            xp: sql`${friendshipLevels.xp} + ${amount}`,
            lastActivityAt: new Date(),
            updatedAt: new Date(),
          },
        });
    } catch (error) {
      this.logger.warn({ err: error, guildId, userA, userB }, "failed to update friendship XP");
    }
  }

  async get(guildId: string, firstUserId: string, secondUserId: string): Promise<FriendshipLevelRow | null> {
    const [userA, userB] = this.key(firstUserId, secondUserId);
    const [row] = await this.db
      .select()
      .from(friendshipLevels)
      .where(and(eq(friendshipLevels.guildId, guildId), eq(friendshipLevels.userA, userA), eq(friendshipLevels.userB, userB)))
      .limit(1);
    return row ?? null;
  }

  async leaderboard(guildId: string, limit = 10): Promise<FriendshipLevelRow[]> {
    return this.db
      .select()
      .from(friendshipLevels)
      .where(eq(friendshipLevels.guildId, guildId))
      .orderBy(desc(friendshipLevels.xp))
      .limit(limit);
  }

  async addTimeTogether(guildId: string, firstUserId: string, secondUserId: string, seconds: number): Promise<void> {
    if (seconds <= 0 || firstUserId === secondUserId) return;
    const [userA, userB] = this.key(firstUserId, secondUserId);
    try {
      await this.db
        .insert(friendshipLevels)
        .values({ guildId, userA, userB, xp: 0, timeTogetherSeconds: seconds, lastActivityAt: new Date() })
        .onConflictDoUpdate({
          target: [friendshipLevels.guildId, friendshipLevels.userA, friendshipLevels.userB],
          set: {
            timeTogetherSeconds: sql`${friendshipLevels.timeTogetherSeconds} + ${seconds}`,
            lastActivityAt: new Date(),
            updatedAt: new Date(),
          },
        });
    } catch (error) {
      this.logger.warn({ err: error, guildId, userA, userB }, "failed to update friendship time");
    }
  }
}
