import { and, desc, eq, sql } from "drizzle-orm";
import { friendshipLevels, type Database, type FriendshipLevelRow } from "@siela/db";
import type { Logger } from "../lib/logger.js";
import type { ValkeyService } from "./valkey.js";

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

interface PendingDelta {
  guildId: string;
  userA: string;
  userB: string;
  xp: number;
  seconds: number;
}

const FLUSH_INTERVAL_MS = 30_000;
const XP_KEY = "siela:friendship:xp";
const TIME_KEY = "siela:friendship:time";
const PENDING_KEY = "siela:friendship:pending";
const DRAIN_SCRIPT = `
local pending = redis.call('SMEMBERS', KEYS[1])
local out = {}
for _, key in ipairs(pending) do
  local xp = tonumber(redis.call('HGET', KEYS[2], key) or '0')
  local seconds = tonumber(redis.call('HGET', KEYS[3], key) or '0')
  redis.call('HDEL', KEYS[2], key)
  redis.call('HDEL', KEYS[3], key)
  redis.call('SREM', KEYS[1], key)
  table.insert(out, key)
  table.insert(out, tostring(xp or 0))
  table.insert(out, tostring(seconds or 0))
end
return out
`;

export class FriendshipService {
  private timer: NodeJS.Timeout | null = null;
  private flushPromise: Promise<void> | null = null;
  private readonly fallback = new Map<string, PendingDelta>();

  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
    private readonly valkey: ValkeyService,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush().catch((error) => this.logger.warn({ err: error }, "friendship flush failed"));
    }, FLUSH_INTERVAL_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  private key(a: string, b: string): [string, string] {
    return a < b ? [a, b] : [b, a];
  }

  private pairKey(guildId: string, userA: string, userB: string): string {
    return `${guildId}|${userA}|${userB}`;
  }

  private parsePairKey(key: string): { guildId: string; userA: string; userB: string } | null {
    const [guildId, userA, userB] = key.split("|");
    if (!guildId || !userA || !userB) return null;
    return { guildId, userA, userB };
  }

  private async enqueue(deltas: PendingDelta[]): Promise<void> {
    if (!deltas.length) return;
    const client = this.valkey.client;
    if (client) {
      try {
        const pipeline = client.pipeline();
        for (const delta of deltas) {
          const key = this.pairKey(delta.guildId, delta.userA, delta.userB);
          if (delta.xp > 0) pipeline.hincrby(XP_KEY, key, delta.xp);
          if (delta.seconds > 0) pipeline.hincrby(TIME_KEY, key, delta.seconds);
          pipeline.sadd(PENDING_KEY, key);
        }
        await pipeline.exec();
        return;
      } catch (error) {
        this.logger.warn({ err: error }, "valkey friendship write failed; using memory fallback");
      }
    }
    for (const delta of deltas) {
      const key = this.pairKey(delta.guildId, delta.userA, delta.userB);
      const current = this.fallback.get(key) ?? { ...delta, xp: 0, seconds: 0 };
      current.xp += delta.xp;
      current.seconds += delta.seconds;
      this.fallback.set(key, current);
    }
  }

  async addBatch(
    items: Array<{ guildId: string; firstUserId: string; secondUserId: string; xp?: number; seconds?: number }>,
  ): Promise<void> {
    const deltas: PendingDelta[] = [];
    for (const item of items) {
      const xp = item.xp ?? 0;
      const seconds = item.seconds ?? 0;
      if (item.firstUserId === item.secondUserId || (xp <= 0 && seconds <= 0)) continue;
      const [userA, userB] = this.key(item.firstUserId, item.secondUserId);
      deltas.push({ guildId: item.guildId, userA, userB, xp, seconds });
    }
    await this.enqueue(deltas);
  }

  async addXp(guildId: string, firstUserId: string, secondUserId: string, amount: number): Promise<void> {
    if (amount <= 0) return;
    await this.addBatch([{ guildId, firstUserId, secondUserId, xp: amount }]);
  }

  async addTimeTogether(guildId: string, firstUserId: string, secondUserId: string, seconds: number): Promise<void> {
    if (seconds <= 0) return;
    await this.addBatch([{ guildId, firstUserId, secondUserId, seconds }]);
  }

  private async writeDelta(delta: PendingDelta): Promise<void> {
    await this.db
      .insert(friendshipLevels)
      .values({
        guildId: delta.guildId,
        userA: delta.userA,
        userB: delta.userB,
        xp: delta.xp,
        timeTogetherSeconds: delta.seconds,
        lastActivityAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [friendshipLevels.guildId, friendshipLevels.userA, friendshipLevels.userB],
        set: {
          xp: sql`${friendshipLevels.xp} + ${delta.xp}`,
          timeTogetherSeconds: sql`${friendshipLevels.timeTogetherSeconds} + ${delta.seconds}`,
          lastActivityAt: new Date(),
          updatedAt: new Date(),
        },
      });
  }

  async flush(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.doFlush().finally(() => {
      this.flushPromise = null;
    });
    return this.flushPromise;
  }

  private async doFlush(): Promise<void> {
    const client = this.valkey.client;
    if (client) {
      try {
        const raw = (await client.eval(DRAIN_SCRIPT, 3, PENDING_KEY, XP_KEY, TIME_KEY)) as unknown;
        const values = Array.isArray(raw) ? raw.map(String) : [];
        for (let index = 0; index + 2 < values.length; index += 3) {
          const key = values[index]!;
          const parsed = this.parsePairKey(key);
          const xp = Number(values[index + 1] ?? 0);
          const seconds = Number(values[index + 2] ?? 0);
          if (!parsed || (!xp && !seconds)) continue;
          const delta = { ...parsed, xp, seconds };
          try {
            await this.writeDelta(delta);
          } catch (error) {
            this.logger.warn({ err: error, key }, "friendship DB flush failed; restoring to valkey");
            await client
              .pipeline()
              .hincrby(XP_KEY, key, xp)
              .hincrby(TIME_KEY, key, seconds)
              .sadd(PENDING_KEY, key)
              .exec()
              .catch(() => undefined);
          }
        }
      } catch (error) {
        this.logger.warn({ err: error }, "friendship valkey drain failed; keeping deltas queued");
      }
    }

    for (const [key, delta] of [...this.fallback]) {
      try {
        await this.writeDelta(delta);
        this.fallback.delete(key);
      } catch (error) {
        this.logger.warn({ err: error, key }, "friendship fallback flush failed");
      }
    }
  }

  async get(guildId: string, firstUserId: string, secondUserId: string): Promise<FriendshipLevelRow | null> {
    await this.flush();
    const [userA, userB] = this.key(firstUserId, secondUserId);
    const [row] = await this.db
      .select()
      .from(friendshipLevels)
      .where(and(eq(friendshipLevels.guildId, guildId), eq(friendshipLevels.userA, userA), eq(friendshipLevels.userB, userB)))
      .limit(1);
    return row ?? null;
  }

  async leaderboard(guildId: string, limit = 10): Promise<FriendshipLevelRow[]> {
    await this.flush();
    return this.db
      .select()
      .from(friendshipLevels)
      .where(eq(friendshipLevels.guildId, guildId))
      .orderBy(desc(friendshipLevels.xp))
      .limit(limit);
  }
}
