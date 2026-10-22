import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import {
  economyAccounts,
  economyTransactions,
  premiumPasses,
  type Database,
} from "@siela/db";
import type { Logger } from "../lib/logger.js";
import type { ValkeyService } from "./valkey.js";

const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const STREAK_WINDOW_MS = 36 * 60 * 60 * 1000;
const DAILY_BASE = 10;

export interface EconomyBalance {
  balance: number;
  lastDailyAt: Date | null;
  dailyStreak: number;
}

export class EconomyService {
  constructor(
    private readonly db: Database,
    private readonly valkey: ValkeyService | null,
    private readonly logger: Logger,
  ) {}

  private get redis() {
    return this.valkey?.client ?? null;
  }

  async ensureAccount(guildId: string, userId: string): Promise<void> {
    await this.db
      .insert(economyAccounts)
      .values({ guildId, userId })
      .onConflictDoNothing();
  }

  async getBalance(guildId: string, userId: string): Promise<EconomyBalance> {
    const redis = this.redis;
    const cacheKey = `siela:economy:bal:${guildId}:${userId}`;
    if (redis) {
      const cached = await redis.get(cacheKey).catch(() => null);
      if (cached) {
        try {
          return JSON.parse(cached) as EconomyBalance;
        } catch {
          // ignore
        }
      }
    }

    await this.ensureAccount(guildId, userId);
    const [row] = await this.db
      .select({
        balance: economyAccounts.balance,
        lastDailyAt: economyAccounts.lastDailyAt,
        dailyStreak: economyAccounts.dailyStreak,
      })
      .from(economyAccounts)
      .where(and(eq(economyAccounts.guildId, guildId), eq(economyAccounts.userId, userId)));
    const result: EconomyBalance = {
      balance: row?.balance ?? 0,
      lastDailyAt: row?.lastDailyAt ?? null,
      dailyStreak: row?.dailyStreak ?? 0,
    };
    if (redis) {
      await redis.set(cacheKey, JSON.stringify(result), "EX", 60).catch(() => undefined);
    }
    return result;
  }

  private async invalidateBalance(guildId: string, userId: string): Promise<void> {
    const redis = this.redis;
    if (!redis) return;
    await redis.del(`siela:economy:bal:${guildId}:${userId}`).catch(() => undefined);
    await redis.del(`siela:economy:top:${guildId}`).catch(() => undefined);
  }

  async daily(
    guildId: string,
    userId: string,
  ): Promise<{ amount: number; streak: number; nextAt: Date }> {
    await this.ensureAccount(guildId, userId);
    const now = new Date();
    const cutoff = new Date(now.getTime() - DAILY_COOLDOWN_MS);
    const streakCutoff = new Date(now.getTime() - STREAK_WINDOW_MS);
    const amount = DAILY_BASE;

    const updated = await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(economyAccounts)
        .set({
          balance: sql`${economyAccounts.balance} + ${amount}`,
          totalEarned: sql`${economyAccounts.totalEarned} + ${amount}`,
          lastDailyAt: now,
          dailyStreak: sql`CASE WHEN ${economyAccounts.lastDailyAt} IS NULL OR ${economyAccounts.lastDailyAt} < ${streakCutoff.toISOString()}::timestamptz THEN 1 ELSE ${economyAccounts.dailyStreak} + 1 END`,
          updatedAt: now,
        })
        .where(
          and(
            eq(economyAccounts.guildId, guildId),
            eq(economyAccounts.userId, userId),
            or(isNull(economyAccounts.lastDailyAt), lte(economyAccounts.lastDailyAt, cutoff)),
          ),
        )
        .returning({
          balance: economyAccounts.balance,
          dailyStreak: economyAccounts.dailyStreak,
        });
      if (!rows.length) return null;
      await tx.insert(economyTransactions).values({
        guildId,
        toUserId: userId,
        amount,
        kind: "daily",
        reason: "daily claim",
      });
      return rows[0]!;
    });

    if (!updated) {
      const current = await this.getBalance(guildId, userId);
      const nextAt = current.lastDailyAt
        ? new Date(current.lastDailyAt.getTime() + DAILY_COOLDOWN_MS)
        : now;
      throw new Error(`DAILY_COOLDOWN:${nextAt.toISOString()}`);
    }

    await this.invalidateBalance(guildId, userId);
    const nextAt = new Date(now.getTime() + DAILY_COOLDOWN_MS);
    const multiplier = Math.min(updated.dailyStreak, 7);
    const finalAmount = amount * multiplier;
    // The base update above only added DAILY_BASE; apply streak bonus now.
    if (multiplier > 1) {
      const bonus = amount * (multiplier - 1);
      await this.db.transaction(async (tx) => {
        await tx
          .update(economyAccounts)
          .set({
            balance: sql`${economyAccounts.balance} + ${bonus}`,
            totalEarned: sql`${economyAccounts.totalEarned} + ${bonus}`,
            updatedAt: new Date(),
          })
          .where(and(eq(economyAccounts.guildId, guildId), eq(economyAccounts.userId, userId)));
        await tx.insert(economyTransactions).values({
          guildId,
          toUserId: userId,
          amount: bonus,
          kind: "daily",
          reason: `daily streak bonus x${multiplier}`,
        });
      });
      await this.invalidateBalance(guildId, userId);
    }

    return { amount: finalAmount, streak: updated.dailyStreak, nextAt };
  }


  async work(guildId: string, userId: string): Promise<{ amount: number; nextAt: Date }> {
    await this.ensureAccount(guildId, userId);
    const [account] = await this.db
      .select({ lastWorkAt: economyAccounts.lastWorkAt })
      .from(economyAccounts)
      .where(and(eq(economyAccounts.guildId, guildId), eq(economyAccounts.userId, userId)));
    const now = new Date();
    if (account?.lastWorkAt && account.lastWorkAt.getTime() > now.getTime() - 2 * 60 * 60 * 1000) {
      throw new Error(`WORK_COOLDOWN:${new Date(account.lastWorkAt.getTime() + 2 * 60 * 60 * 1000).toISOString()}`);
    }
    const amount = 1 + Math.floor(Math.random() * 4);
    await this.db.transaction(async (tx) => {
      await tx
        .update(economyAccounts)
        .set({
          balance: sql`${economyAccounts.balance} + ${amount}`,
          totalEarned: sql`${economyAccounts.totalEarned} + ${amount}`,
          lastWorkAt: now,
          updatedAt: now,
        })
        .where(and(eq(economyAccounts.guildId, guildId), eq(economyAccounts.userId, userId)));
      await tx.insert(economyTransactions).values({
        guildId,
        toUserId: userId,
        amount,
        kind: "work",
        reason: "work shift",
      });
    });
    await this.invalidateBalance(guildId, userId);
    return { amount, nextAt: new Date(now.getTime() + 2 * 60 * 60 * 1000) };
  }

  async transfer(guildId: string, fromUserId: string, toUserId: string, amount: number): Promise<void> {
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("INVALID_AMOUNT");
    if (fromUserId === toUserId) throw new Error("SELF_TRANSFER");
    if (amount > 1_000_000) throw new Error("AMOUNT_TOO_LARGE");

    await this.ensureAccount(guildId, fromUserId);
    await this.ensureAccount(guildId, toUserId);

    await this.db.transaction(async (tx) => {
      const debited = await tx
        .update(economyAccounts)
        .set({
          balance: sql`${economyAccounts.balance} - ${amount}`,
          totalSpent: sql`${economyAccounts.totalSpent} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(economyAccounts.guildId, guildId),
            eq(economyAccounts.userId, fromUserId),
            gte(economyAccounts.balance, amount),
          ),
        )
        .returning({ userId: economyAccounts.userId });
      if (!debited.length) throw new Error("INSUFFICIENT_FUNDS");

      await tx
        .update(economyAccounts)
        .set({
          balance: sql`${economyAccounts.balance} + ${amount}`,
          totalEarned: sql`${economyAccounts.totalEarned} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(and(eq(economyAccounts.guildId, guildId), eq(economyAccounts.userId, toUserId)));

      await tx.insert(economyTransactions).values({
        guildId,
        fromUserId,
        toUserId,
        amount,
        kind: "transfer",
        reason: "user transfer",
      });
    });

    await this.invalidateBalance(guildId, fromUserId);
    await this.invalidateBalance(guildId, toUserId);
  }

  async award(
    guildId: string,
    userId: string,
    amount: number,
    kind: string,
    idempotencyKey?: string,
  ): Promise<{ amount: number; duplicate: boolean }> {
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("INVALID_AMOUNT");
    await this.ensureAccount(guildId, userId);

    if (idempotencyKey) {
      const [existing] = await this.db
        .select({ id: economyTransactions.id })
        .from(economyTransactions)
        .where(and(eq(economyTransactions.guildId, guildId), eq(economyTransactions.idempotencyKey, idempotencyKey)));
      if (existing) return { amount: 0, duplicate: true };
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(economyAccounts)
        .set({
          balance: sql`${economyAccounts.balance} + ${amount}`,
          totalEarned: sql`${economyAccounts.totalEarned} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(and(eq(economyAccounts.guildId, guildId), eq(economyAccounts.userId, userId)));
      await tx.insert(economyTransactions).values({
        guildId,
        toUserId: userId,
        amount,
        kind,
        idempotencyKey: idempotencyKey ?? null,
      });
    });

    await this.invalidateBalance(guildId, userId);
    return { amount, duplicate: false };
  }

  async adjust(
    guildId: string,
    userId: string,
    amount: number,
    reason: string,
    actorId: string,
  ): Promise<void> {
    if (!Number.isInteger(amount) || amount === 0) throw new Error("INVALID_AMOUNT");
    await this.ensureAccount(guildId, userId);

    await this.db.transaction(async (tx) => {
      if (amount > 0) {
        await tx
          .update(economyAccounts)
          .set({
            balance: sql`${economyAccounts.balance} + ${amount}`,
            totalEarned: sql`${economyAccounts.totalEarned} + ${amount}`,
            updatedAt: new Date(),
          })
          .where(and(eq(economyAccounts.guildId, guildId), eq(economyAccounts.userId, userId)));
      } else {
        const needed = -amount;
        const debited = await tx
          .update(economyAccounts)
          .set({
            balance: sql`${economyAccounts.balance} - ${needed}`,
            totalSpent: sql`${economyAccounts.totalSpent} + ${needed}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(economyAccounts.guildId, guildId),
              eq(economyAccounts.userId, userId),
              gte(economyAccounts.balance, needed),
            ),
          )
          .returning({ userId: economyAccounts.userId });
        if (!debited.length) throw new Error("INSUFFICIENT_FUNDS");
      }

      await tx.insert(economyTransactions).values({
        guildId,
        fromUserId: amount < 0 ? userId : null,
        toUserId: amount > 0 ? userId : null,
        amount: Math.abs(amount),
        kind: "admin_adjust",
        reason: `${reason} by ${actorId}`,
      });
    });

    await this.invalidateBalance(guildId, userId);
  }

  async leaderboard(
    guildId: string,
    limit = 10,
    offset = 0,
  ): Promise<Array<{ userId: string; balance: number }>> {
    const redis = this.redis;
    const cacheKey = `siela:economy:top:${guildId}`;
    if (redis && offset === 0) {
      const cached = await redis.get(cacheKey).catch(() => null);
      if (cached) {
        try {
          return JSON.parse(cached) as Array<{ userId: string; balance: number }>;
        } catch {
          // ignore
        }
      }
    }

    const rows = await this.db
      .select({ userId: economyAccounts.userId, balance: economyAccounts.balance })
      .from(economyAccounts)
      .where(eq(economyAccounts.guildId, guildId))
      .orderBy(desc(economyAccounts.balance))
      .limit(limit)
      .offset(offset);

    const result = rows.map((row) => ({ userId: row.userId, balance: row.balance }));
    if (redis && offset === 0) {
      await redis.set(cacheKey, JSON.stringify(result), "EX", 30).catch(() => undefined);
    }
    return result;
  }


  async spend(
    guildId: string,
    userId: string,
    amount: number,
    kind: string,
    idempotencyKey?: string,
  ): Promise<void> {
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("INVALID_AMOUNT");
    await this.ensureAccount(guildId, userId);
    if (idempotencyKey) {
      const [existing] = await this.db
        .select({ id: economyTransactions.id })
        .from(economyTransactions)
        .where(and(eq(economyTransactions.guildId, guildId), eq(economyTransactions.idempotencyKey, idempotencyKey)));
      if (existing) return;
    }
    await this.db.transaction(async (tx) => {
      const debited = await tx
        .update(economyAccounts)
        .set({
          balance: sql`${economyAccounts.balance} - ${amount}`,
          totalSpent: sql`${economyAccounts.totalSpent} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(economyAccounts.guildId, guildId),
            eq(economyAccounts.userId, userId),
            gte(economyAccounts.balance, amount),
          ),
        )
        .returning({ userId: economyAccounts.userId });
      if (!debited.length) throw new Error("INSUFFICIENT_FUNDS");
      await tx.insert(economyTransactions).values({
        guildId,
        fromUserId: userId,
        amount,
        kind,
        idempotencyKey: idempotencyKey ?? null,
      });
    });
    await this.invalidateBalance(guildId, userId);
  }

  async hasPremium(guildId: string, userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ expiresAt: premiumPasses.expiresAt })
      .from(premiumPasses)
      .where(and(eq(premiumPasses.guildId, guildId), eq(premiumPasses.userId, userId)));
    if (!row) return false;
    return row.expiresAt.getTime() > Date.now();
  }

  async grantPremium(guildId: string, userId: string, days: number, actorId: string): Promise<Date> {
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await this.db
      .insert(premiumPasses)
      .values({ guildId, userId, expiresAt, grantedBy: actorId })
      .onConflictDoUpdate({
        target: [premiumPasses.guildId, premiumPasses.userId],
        set: { expiresAt, grantedBy: actorId },
      });
    await this.db.insert(economyTransactions).values({
      guildId,
      toUserId: userId,
      amount: 0,
      kind: "premium_grant",
      reason: `${days} days by ${actorId}`,
    });
    return expiresAt;
  }

  async deleteUserData(guildId: string, userId: string): Promise<void> {
    await this.db.delete(economyAccounts).where(and(eq(economyAccounts.guildId, guildId), eq(economyAccounts.userId, userId)));
    await this.db.delete(premiumPasses).where(and(eq(premiumPasses.guildId, guildId), eq(premiumPasses.userId, userId)));
    await this.db
      .delete(economyTransactions)
      .where(
        and(
          eq(economyTransactions.guildId, guildId),
          or(eq(economyTransactions.fromUserId, userId), eq(economyTransactions.toUserId, userId)),
        ),
      );
  }

  async rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
    const redis = this.redis;
    if (!redis) return true;
    const redisKey = `siela:economy:rl:${key}`;
    const count = await redis.incr(redisKey).catch(() => 0);
    if (count === 1) {
      await redis.pexpire(redisKey, windowMs).catch(() => undefined);
    }
    return count <= limit;
  }
}
