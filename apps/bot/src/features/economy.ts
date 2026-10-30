import { renderBlackjackTable } from "./blackjack-table.js";
import { styleMessage } from "./ui.js";
import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import {
  economyAccounts,
  economyHoldings,
  economyMarkets,
  economyStocks,
  economyTransactions,
  premiumPasses,
  economyShopItems,
  economyInventory,
  type Database,
} from "@siela/db";
import type { Logger } from "../lib/logger.js";
import { MAX_STOCK_SHARES } from "@siela/shared";
import { AttachmentBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import type { ReplyPayload } from "../framework/types.js";
import { actionRow, card } from "./ui.js";
import type { ValkeyService } from "./valkey.js";
import {
  MAX_CATCHUP_TICKS,
  STOCK_SEEDS,
  STOCK_TICK_MS,
  advanceStock,
  indexChange,
  marketIndex,
  nextAverageCost,
  stockSeed,
  tradeFee,
  type MarketStockView,
  type MarketView,
  type PortfolioView,
  type StockBuyResult,
  type StockSellResult,
  type StockState,
} from "./stocks.js";

const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const STREAK_WINDOW_MS = 36 * 60 * 60 * 1000;
const DAILY_BASE = 10;
const STARTING_BALANCE = 50;

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface EconomyBalance {
  balance: number;
  lastDailyAt: Date | null;
  lastWorkAt: Date | null;
  dailyStreak: number;
  totalEarned: number;
  totalSpent: number;
}

interface BlackjackGame {
  guildId: string;
  userId: string;
  bet: number;
  player: string[];
  dealer: string[];
  status: "playing" | "finished";
  result?: string;
  payout?: number;
  startedAt: number;
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
    await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(economyAccounts)
        .values({ guildId, userId, balance: STARTING_BALANCE })
        .onConflictDoNothing()
        .returning({ userId: economyAccounts.userId });
      if (!inserted.length || STARTING_BALANCE <= 0) return;
      await tx.insert(economyTransactions).values({
        guildId,
        toUserId: userId,
        amount: STARTING_BALANCE,
        kind: "starting_balance",
        reason: "welcome grant",
      });
    });
  }

  async getBalance(guildId: string, userId: string): Promise<EconomyBalance> {
    const redis = this.redis;
    const cacheKey = `siela:economy:bal:${guildId}:${userId}`;
    if (redis) {
      const cached = await redis.get(cacheKey).catch(() => null);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as EconomyBalance;
          if (parsed.lastDailyAt) parsed.lastDailyAt = new Date(parsed.lastDailyAt as string | Date);
          if (parsed.lastWorkAt) parsed.lastWorkAt = new Date(parsed.lastWorkAt as string | Date);
          parsed.totalEarned = Number(parsed.totalEarned ?? 0);
          parsed.totalSpent = Number(parsed.totalSpent ?? 0);
          return parsed;
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
        lastWorkAt: economyAccounts.lastWorkAt,
        dailyStreak: economyAccounts.dailyStreak,
        totalEarned: economyAccounts.totalEarned,
        totalSpent: economyAccounts.totalSpent,
      })
      .from(economyAccounts)
      .where(and(eq(economyAccounts.guildId, guildId), eq(economyAccounts.userId, userId)));
    const result: EconomyBalance = {
      balance: row?.balance ?? 0,
      lastDailyAt: row?.lastDailyAt ? new Date(row.lastDailyAt as string | Date) : null,
      lastWorkAt: row?.lastWorkAt ? new Date(row.lastWorkAt as string | Date) : null,
      dailyStreak: row?.dailyStreak ?? 0,
      totalEarned: Number(row?.totalEarned ?? 0),
      totalSpent: Number(row?.totalSpent ?? 0),
    };
    if (redis) {
      await redis.set(cacheKey, JSON.stringify(result), "EX", 60).catch(() => undefined);
    }
    return result;
  }

  /** One-based position among accounts with a strictly higher balance. */
  async getRank(guildId: string, userId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(economyAccounts)
      .where(
        and(
          eq(economyAccounts.guildId, guildId),
          sql`${economyAccounts.balance} > (select ${economyAccounts.balance} from ${economyAccounts} where ${economyAccounts.guildId} = ${guildId} and ${economyAccounts.userId} = ${userId})`,
        ),
      );
    return Number(row?.count ?? 0) + 1;
  }

  async invalidateBalance(guildId: string, userId: string): Promise<void> {
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

    const [account] = await this.db
      .select({ lastDailyAt: economyAccounts.lastDailyAt, dailyStreak: economyAccounts.dailyStreak })
      .from(economyAccounts)
      .where(and(eq(economyAccounts.guildId, guildId), eq(economyAccounts.userId, userId)));
    const lastDaily = account?.lastDailyAt ? new Date(account.lastDailyAt as string | Date) : null;
    if (lastDaily && lastDaily.getTime() > cutoff.getTime()) {
      throw new Error(`DAILY_COOLDOWN:${new Date(lastDaily.getTime() + DAILY_COOLDOWN_MS).toISOString()}`);
    }
    const streak = lastDaily && lastDaily.getTime() >= streakCutoff.getTime()
      ? (account?.dailyStreak ?? 0) + 1
      : 1;
    const multiplier = Math.min(streak, 7);
    const amount = DAILY_BASE * multiplier;

    const updated = await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(economyAccounts)
        .set({
          balance: sql`${economyAccounts.balance} + ${amount}`,
          totalEarned: sql`${economyAccounts.totalEarned} + ${amount}`,
          lastDailyAt: now,
          dailyStreak: streak,
          updatedAt: now,
        })
        .where(
          and(
            eq(economyAccounts.guildId, guildId),
            eq(economyAccounts.userId, userId),
            or(isNull(economyAccounts.lastDailyAt), lte(economyAccounts.lastDailyAt, cutoff)),
          ),
        )
        .returning({ dailyStreak: economyAccounts.dailyStreak });
      if (!rows.length) return null;
      await tx.insert(economyTransactions).values({
        guildId,
        toUserId: userId,
        amount,
        kind: "daily",
        reason: `daily claim x${multiplier}`,
      });
      return rows[0]!;
    });

    if (!updated) {
      const current = await this.getBalance(guildId, userId);
      const retryLast = current.lastDailyAt ? new Date(current.lastDailyAt as string | Date) : null;
      const nextAt = retryLast
        ? new Date(retryLast.getTime() + DAILY_COOLDOWN_MS)
        : now;
      throw new Error(`DAILY_COOLDOWN:${nextAt.toISOString()}`);
    }

    await this.invalidateBalance(guildId, userId);
    return { amount, streak: updated.dailyStreak, nextAt: new Date(now.getTime() + DAILY_COOLDOWN_MS) };
  }


  async work(guildId: string, userId: string): Promise<{ amount: number; nextAt: Date }> {
    await this.ensureAccount(guildId, userId);
    const [account] = await this.db
      .select({ lastWorkAt: economyAccounts.lastWorkAt })
      .from(economyAccounts)
      .where(and(eq(economyAccounts.guildId, guildId), eq(economyAccounts.userId, userId)));
    const now = new Date();
    const cutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    if (account?.lastWorkAt && new Date(account.lastWorkAt as string | Date).getTime() > cutoff.getTime()) {
      throw new Error(`WORK_COOLDOWN:${new Date(new Date(account.lastWorkAt as string | Date).getTime() + 2 * 60 * 60 * 1000).toISOString()}`);
    }
    const amount = 3 + Math.floor(Math.random() * 6);
    const updated = await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(economyAccounts)
        .set({
          balance: sql`${economyAccounts.balance} + ${amount}`,
          totalEarned: sql`${economyAccounts.totalEarned} + ${amount}`,
          lastWorkAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(economyAccounts.guildId, guildId),
            eq(economyAccounts.userId, userId),
            or(isNull(economyAccounts.lastWorkAt), lte(economyAccounts.lastWorkAt, cutoff)),
          ),
        )
        .returning({ userId: economyAccounts.userId });
      if (!rows.length) return false;
      await tx.insert(economyTransactions).values({
        guildId,
        toUserId: userId,
        amount,
        kind: "work",
        reason: "work shift",
      });
      return true;
    });
    if (!updated) {
      const [latest] = await this.db
        .select({ lastWorkAt: economyAccounts.lastWorkAt })
        .from(economyAccounts)
        .where(and(eq(economyAccounts.guildId, guildId), eq(economyAccounts.userId, userId)));
      const nextAt = latest?.lastWorkAt
        ? new Date(new Date(latest.lastWorkAt as string | Date).getTime() + 2 * 60 * 60 * 1000)
        : now;
      throw new Error(`WORK_COOLDOWN:${nextAt.toISOString()}`);
    }
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
          const rows = JSON.parse(cached) as Array<{ userId: string; balance: number }>;
          if (rows.length >= limit) return rows.slice(0, limit);
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
    await this.db.delete(economyHoldings).where(and(eq(economyHoldings.guildId, guildId), eq(economyHoldings.userId, userId)));
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

  async listShopItems(guildId: string) {
    return this.db
      .select()
      .from(economyShopItems)
      .where(eq(economyShopItems.guildId, guildId))
      .orderBy(economyShopItems.price);
  }

  async getShopItem(guildId: string, key: string) {
    const [row] = await this.db
      .select()
      .from(economyShopItems)
      .where(and(eq(economyShopItems.guildId, guildId), eq(economyShopItems.key, key)));
    return row ?? null;
  }

  async addShopItem(input: {
    guildId: string;
    key: string;
    name: string;
    description?: string | null;
    price: number;
    roleId?: string | null;
    stock?: number | null;
    createdBy: string;
  }) {
    if (!/^[a-z0-9_-]{1,32}$/i.test(input.key)) throw new Error("INVALID_KEY");
    if (!Number.isInteger(input.price) || input.price <= 0) throw new Error("INVALID_PRICE");
    await this.db.insert(economyShopItems).values({
      guildId: input.guildId,
      key: input.key.toLowerCase(),
      name: input.name,
      description: input.description ?? null,
      price: input.price,
      roleId: input.roleId ?? null,
      stock: input.stock ?? null,
      createdBy: input.createdBy,
    });
  }

  async removeShopItem(guildId: string, key: string): Promise<boolean> {
    const result = await this.db
      .delete(economyShopItems)
      .where(and(eq(economyShopItems.guildId, guildId), eq(economyShopItems.key, key.toLowerCase())))
      .returning({ id: economyShopItems.id });
    return result.length > 0;
  }

  async buyItem(guildId: string, userId: string, key: string): Promise<{ item: typeof economyShopItems.$inferSelect; roleGranted: boolean }> {
    await this.ensureAccount(guildId, userId);
    let item: typeof economyShopItems.$inferSelect | null = null;
    await this.db.transaction(async (tx) => {
      const [lockedItem] = await tx
        .select()
        .from(economyShopItems)
        .where(and(eq(economyShopItems.guildId, guildId), eq(economyShopItems.key, key.toLowerCase())))
        .for("update");
      if (!lockedItem) throw new Error("ITEM_NOT_FOUND");
      if (lockedItem.stock !== null && lockedItem.stock <= 0) throw new Error("OUT_OF_STOCK");
      item = lockedItem;

      const debited = await tx
        .update(economyAccounts)
        .set({
          balance: sql`${economyAccounts.balance} - ${lockedItem.price}`,
          totalSpent: sql`${economyAccounts.totalSpent} + ${lockedItem.price}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(economyAccounts.guildId, guildId),
            eq(economyAccounts.userId, userId),
            gte(economyAccounts.balance, lockedItem.price),
          ),
        )
        .returning({ userId: economyAccounts.userId });
      if (!debited.length) throw new Error("INSUFFICIENT_FUNDS");

      if (lockedItem.stock !== null) {
        await tx
          .update(economyShopItems)
          .set({ stock: lockedItem.stock - 1 })
          .where(and(eq(economyShopItems.guildId, guildId), eq(economyShopItems.key, lockedItem.key)));
      }

      await tx
        .insert(economyInventory)
        .values({ guildId, userId, itemKey: lockedItem.key, quantity: 1 })
        .onConflictDoUpdate({
          target: [economyInventory.guildId, economyInventory.userId, economyInventory.itemKey],
          set: { quantity: sql`${economyInventory.quantity} + 1`, updatedAt: new Date() },
        });

      await tx.insert(economyTransactions).values({
        guildId,
        fromUserId: userId,
        amount: lockedItem.price,
        kind: "shop_purchase",
        reason: `shop:${lockedItem.key}`,
      });
    });
    await this.invalidateBalance(guildId, userId);
    return { item: item!, roleGranted: Boolean(item!.roleId) };
  }

  async inventory(guildId: string, userId: string) {
    return this.db
      .select()
      .from(economyInventory)
      .where(and(eq(economyInventory.guildId, guildId), eq(economyInventory.userId, userId)));
  }

  async countDeluluUsesToday(guildId: string, userId: string, kind: string): Promise<number> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [row] = await this.db
      .select({
        used: sql<number>`count(*) filter (where ${economyTransactions.kind} = ${kind})::int`,
        refunded: sql<number>`count(*) filter (where ${economyTransactions.kind} = 'delulu_refund' and ${economyTransactions.idempotencyKey} like ${`delulu:${kind}:%:refund`})::int`,
      })
      .from(economyTransactions)
      .where(
        and(
          eq(economyTransactions.guildId, guildId),
          or(
            eq(economyTransactions.fromUserId, userId),
            eq(economyTransactions.toUserId, userId),
          ),
          gte(economyTransactions.createdAt, start),
        ),
      );
    return Math.max(0, Number(row?.used ?? 0) - Number(row?.refunded ?? 0));
  }

  async stats(guildId: string, days = 7): Promise<Array<{ kind: string; total: number; count: number }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({
        kind: economyTransactions.kind,
        total: sql<number>`coalesce(sum(${economyTransactions.amount}), 0)::bigint`,
        count: sql<number>`count(*)::int`,
      })
      .from(economyTransactions)
      .where(and(eq(economyTransactions.guildId, guildId), gte(economyTransactions.createdAt, since)))
      .groupBy(economyTransactions.kind)
      .orderBy(desc(sql`coalesce(sum(${economyTransactions.amount}), 0)`));
    return rows.map((row) => ({
      kind: row.kind,
      total: Number(row.total),
      count: Number(row.count),
    }));
  }

  private async ensureMarketRows(guildId: string): Promise<void> {
    await this.db.insert(economyMarkets).values({ guildId }).onConflictDoNothing();
    await this.db
      .insert(economyStocks)
      .values(
        STOCK_SEEDS.map((seed) => ({
          guildId,
          symbol: seed.symbol,
          name: seed.name,
          sector: seed.sector,
          description: seed.description,
          price: seed.basePrice,
          fairValue: seed.basePrice,
          volatility: seed.volatility,
          history: [seed.basePrice],
        })),
      )
      .onConflictDoNothing();
  }

  private async advanceMarketTx(tx: Transaction, guildId: string): Promise<void> {
    const [market] = await tx
      .select()
      .from(economyMarkets)
      .where(eq(economyMarkets.guildId, guildId))
      .for("update");
    if (!market) return;

    const now = Date.now();
    const elapsed = now - market.lastTickAt.getTime();
    if (elapsed < STOCK_TICK_MS) return;
    const ticks = Math.min(Math.floor(elapsed / STOCK_TICK_MS), MAX_CATCHUP_TICKS);

    const rows = await tx
      .select()
      .from(economyStocks)
      .where(eq(economyStocks.guildId, guildId))
      .for("update");
    const known = new Set(STOCK_SEEDS.map((seed) => seed.symbol));
    for (const row of rows) {
      if (!known.has(row.symbol)) continue;
      let state: StockState = {
        symbol: row.symbol,
        price: row.price,
        fairValue: row.fairValue,
        volatility: row.volatility,
        history: row.history ?? [row.price],
      };
      let lastEvent = row.lastEvent;
      let lastEventAt = row.lastEventAt;
      for (let tick = 0; tick < ticks; tick += 1) {
        const step = advanceStock(state);
        state = step;
        if (step.event) {
          lastEvent = step.event;
          lastEventAt = new Date(now - (ticks - tick - 1) * STOCK_TICK_MS);
        }
      }
      await tx
        .update(economyStocks)
        .set({
          price: state.price,
          fairValue: state.fairValue,
          history: state.history,
          lastEvent,
          lastEventAt,
          updatedAt: new Date(),
        })
        .where(and(eq(economyStocks.guildId, guildId), eq(economyStocks.symbol, row.symbol)));
    }

    const nextTick =
      elapsed > MAX_CATCHUP_TICKS * STOCK_TICK_MS
        ? new Date(now)
        : new Date(market.lastTickAt.getTime() + ticks * STOCK_TICK_MS);
    await tx
      .update(economyMarkets)
      .set({ lastTickAt: nextTick, tickCount: market.tickCount + ticks })
      .where(eq(economyMarkets.guildId, guildId));
  }

  private async advanceMarket(guildId: string): Promise<void> {
    await this.ensureMarketRows(guildId);
    await this.db.transaction(async (tx) => {
      await this.advanceMarketTx(tx, guildId);
    });
  }

  async getMarket(guildId: string): Promise<MarketView> {
    await this.advanceMarket(guildId);
    const [market] = await this.db
      .select()
      .from(economyMarkets)
      .where(eq(economyMarkets.guildId, guildId));
    const rows = await this.db
      .select()
      .from(economyStocks)
      .where(eq(economyStocks.guildId, guildId));
    const order = new Map(STOCK_SEEDS.map((seed, index) => [seed.symbol, index]));
    const stocks: MarketStockView[] = rows
      .filter((row) => order.has(row.symbol))
      .map((row) => ({
        symbol: row.symbol,
        name: row.name,
        sector: row.sector,
        description: row.description,
        price: row.price,
        fairValue: row.fairValue,
        history: row.history ?? [row.price],
        lastEvent: row.lastEvent,
        lastEventAt: row.lastEventAt,
      }))
      .sort((a, b) => (order.get(a.symbol) ?? 99) - (order.get(b.symbol) ?? 99));
    return {
      stocks,
      index: marketIndex(stocks),
      indexChange: indexChange(stocks),
      lastTickAt: market?.lastTickAt ?? new Date(),
      nextTickAt: new Date((market?.lastTickAt?.getTime() ?? Date.now()) + STOCK_TICK_MS),
    };
  }

  async getPortfolio(guildId: string, userId: string): Promise<PortfolioView> {
    const market = await this.getMarket(guildId);
    const balance = await this.getBalance(guildId, userId);
    const rows = await this.db
      .select()
      .from(economyHoldings)
      .where(and(eq(economyHoldings.guildId, guildId), eq(economyHoldings.userId, userId)));
    const stocks = new Map(market.stocks.map((stock) => [stock.symbol, stock]));
    const holdings = rows
      .filter((row) => row.shares > 0 && stocks.has(row.symbol))
      .map((row) => {
        const stock = stocks.get(row.symbol)!;
        const value = row.shares * stock.price;
        const cost = row.shares * row.avgCost;
        const pnl = value - cost;
        return {
          symbol: row.symbol,
          name: stock.name,
          shares: row.shares,
          avgCost: row.avgCost,
          price: stock.price,
          value,
          cost,
          pnl,
          pnlPct: cost > 0 ? (pnl / cost) * 100 : 0,
        };
      })
      .sort((a, b) => b.value - a.value);
    const holdingsValue = holdings.reduce((total, holding) => total + holding.value, 0);
    const unrealized = holdings.reduce((total, holding) => total + holding.pnl, 0);
    return {
      cash: balance.balance,
      holdings,
      holdingsValue,
      netWorth: balance.balance + holdingsValue,
      unrealized,
    };
  }

  async buyStock(
    guildId: string,
    userId: string,
    rawSymbol: string,
    shares: number,
  ): Promise<StockBuyResult> {
    const seed = stockSeed(rawSymbol);
    if (!seed) throw new Error("UNKNOWN_STOCK");
    if (!Number.isSafeInteger(shares) || shares <= 0 || shares > MAX_STOCK_SHARES) {
      throw new Error("INVALID_SHARES");
    }

    await this.ensureAccount(guildId, userId);
    await this.ensureMarketRows(guildId);

    const result = await this.db.transaction(async (tx) => {
      await this.advanceMarketTx(tx, guildId);
      const [stock] = await tx
        .select()
        .from(economyStocks)
        .where(and(eq(economyStocks.guildId, guildId), eq(economyStocks.symbol, seed.symbol)))
        .for("update");
      if (!stock) throw new Error("UNKNOWN_STOCK");
      const [account] = await tx
        .select()
        .from(economyAccounts)
        .where(and(eq(economyAccounts.guildId, guildId), eq(economyAccounts.userId, userId)))
        .for("update");
      if (!account) throw new Error("ACCOUNT_MISSING");

      const gross = shares * stock.price;
      if (!Number.isSafeInteger(gross)) throw new Error("AMOUNT_TOO_LARGE");
      const fee = tradeFee(gross);
      const total = gross + fee;
      if (account.balance < total) throw new Error("INSUFFICIENT_FUNDS");

      const [holding] = await tx
        .select()
        .from(economyHoldings)
        .where(
          and(
            eq(economyHoldings.guildId, guildId),
            eq(economyHoldings.userId, userId),
            eq(economyHoldings.symbol, stock.symbol),
          ),
        )
        .for("update");
      const oldShares = holding?.shares ?? 0;
      const newShares = oldShares + shares;
      const avgCost = nextAverageCost(oldShares, holding?.avgCost ?? 0, shares, total);
      if (holding) {
        await tx
          .update(economyHoldings)
          .set({ shares: newShares, avgCost, updatedAt: new Date() })
          .where(
            and(
              eq(economyHoldings.guildId, guildId),
              eq(economyHoldings.userId, userId),
              eq(economyHoldings.symbol, stock.symbol),
            ),
          );
      } else {
        await tx.insert(economyHoldings).values({
          guildId,
          userId,
          symbol: stock.symbol,
          shares: newShares,
          avgCost,
        });
      }

      await tx
        .update(economyAccounts)
        .set({
          balance: sql`${economyAccounts.balance} - ${total}`,
          totalSpent: sql`${economyAccounts.totalSpent} + ${total}`,
          updatedAt: new Date(),
        })
        .where(and(eq(economyAccounts.guildId, guildId), eq(economyAccounts.userId, userId)));
      await tx.insert(economyTransactions).values({
        guildId,
        fromUserId: userId,
        amount: total,
        kind: "stock_buy",
        reason: `${stock.symbol} x${shares} @ ${stock.price}`,
      });

      return {
        symbol: stock.symbol,
        shares,
        price: stock.price,
        fee,
        total,
        balance: account.balance - total,
      };
    });

    await this.invalidateBalance(guildId, userId);
    return result;
  }

  async sellStock(
    guildId: string,
    userId: string,
    rawSymbol: string,
    shares: number,
  ): Promise<StockSellResult> {
    const seed = stockSeed(rawSymbol);
    if (!seed) throw new Error("UNKNOWN_STOCK");
    if (!Number.isSafeInteger(shares) || shares <= 0 || shares > MAX_STOCK_SHARES) {
      throw new Error("INVALID_SHARES");
    }

    await this.ensureAccount(guildId, userId);
    await this.ensureMarketRows(guildId);

    const result = await this.db.transaction(async (tx) => {
      await this.advanceMarketTx(tx, guildId);
      const [stock] = await tx
        .select()
        .from(economyStocks)
        .where(and(eq(economyStocks.guildId, guildId), eq(economyStocks.symbol, seed.symbol)))
        .for("update");
      if (!stock) throw new Error("UNKNOWN_STOCK");
      const [account] = await tx
        .select()
        .from(economyAccounts)
        .where(and(eq(economyAccounts.guildId, guildId), eq(economyAccounts.userId, userId)))
        .for("update");
      if (!account) throw new Error("ACCOUNT_MISSING");
      const [holding] = await tx
        .select()
        .from(economyHoldings)
        .where(
          and(
            eq(economyHoldings.guildId, guildId),
            eq(economyHoldings.userId, userId),
            eq(economyHoldings.symbol, stock.symbol),
          ),
        )
        .for("update");
      if (!holding || holding.shares < shares) throw new Error("NOT_ENOUGH_SHARES");

      const gross = shares * stock.price;
      if (!Number.isSafeInteger(gross)) throw new Error("AMOUNT_TOO_LARGE");
      const fee = tradeFee(gross);
      const proceeds = gross - fee;
      if (proceeds <= 0) throw new Error("TRADE_TOO_SMALL");

      const remaining = holding.shares - shares;
      if (remaining === 0) {
        await tx
          .delete(economyHoldings)
          .where(
            and(
              eq(economyHoldings.guildId, guildId),
              eq(economyHoldings.userId, userId),
              eq(economyHoldings.symbol, stock.symbol),
            ),
          );
      } else {
        await tx
          .update(economyHoldings)
          .set({ shares: remaining, updatedAt: new Date() })
          .where(
            and(
              eq(economyHoldings.guildId, guildId),
              eq(economyHoldings.userId, userId),
              eq(economyHoldings.symbol, stock.symbol),
            ),
          );
      }

      await tx
        .update(economyAccounts)
        .set({
          balance: sql`${economyAccounts.balance} + ${proceeds}`,
          updatedAt: new Date(),
        })
        .where(and(eq(economyAccounts.guildId, guildId), eq(economyAccounts.userId, userId)));
      await tx.insert(economyTransactions).values({
        guildId,
        toUserId: userId,
        amount: proceeds,
        kind: "stock_sell",
        reason: `${stock.symbol} x${shares} @ ${stock.price}`,
      });

      return {
        symbol: stock.symbol,
        shares,
        price: stock.price,
        fee,
        proceeds,
        pnl: proceeds - holding.avgCost * shares,
        balance: account.balance + proceeds,
      };
    });

    await this.invalidateBalance(guildId, userId);
    return result;
  }

  private readonly blackjackGames = new Map<string, BlackjackGame>();
  private readonly blackjackShoes = new Map<string, string[]>();


  private blackjackKey(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
  }

  private ensureBlackjackShoe(guildId: string): string[] {
    let shoe = this.blackjackShoes.get(guildId);
    if (!shoe || shoe.length < 20) {
      const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
      const suits = ["♠", "♥", "♦", "♣"];
      const cards: string[] = [];
      for (let deck = 0; deck < 3; deck += 1) {
        for (const suit of suits) {
          for (const rank of ranks) cards.push(`${rank}${suit}`);
        }
      }
      for (let i = cards.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j]!, cards[i]!];
      }
      shoe = cards;
      this.blackjackShoes.set(guildId, shoe);
    }
    return shoe;
  }

  private drawBlackjackCard(guildId: string): string {
    const shoe = this.ensureBlackjackShoe(guildId);
    const card = shoe.shift();
    if (!card) throw new Error("SHOE_EMPTY");
    return card;
  }

  private cardRank(card: string): string {
    return card.slice(0, -1);
  }

  private cardValue(card: string): number {
    const rank = this.cardRank(card);
    if (rank === "A") return 11;
    if (["K", "Q", "J", "10"].includes(rank)) return 10;
    return Number(rank);
  }

  private handValue(cards: string[]): number {
    let total = 0;
    let aces = 0;
    for (const card of cards) {
      total += this.cardValue(card);
      if (this.cardRank(card) === "A") aces += 1;
    }
    while (total > 21 && aces > 0) {
      total -= 10;
      aces -= 1;
    }
    return total;
  }

  private isBlackjack(cards: string[]): boolean {
    return cards.length === 2 && this.handValue(cards) === 21;
  }

  private async resolveBlackjack(game: BlackjackGame): Promise<void> {
    const playerValue = this.handValue(game.player);
    const dealerValue = this.handValue(game.dealer);
    let payout = 0;
    let result = "";
    if (playerValue > 21) {
      result = "Bust. You lose.";
    } else if (this.isBlackjack(game.player) && !this.isBlackjack(game.dealer)) {
      result = "Blackjack! You win.";
      payout = Math.floor(game.bet * 2.5);
    } else if (this.isBlackjack(game.dealer) && !this.isBlackjack(game.player)) {
      result = "Dealer has blackjack. You lose.";
    } else if (dealerValue > 21) {
      result = "Dealer busts. You win!";
      payout = game.bet * 2;
    } else if (playerValue > dealerValue) {
      result = "You win!";
      payout = game.bet * 2;
    } else if (playerValue < dealerValue) {
      result = "You lose.";
    } else {
      result = "Push. Bet returned.";
      payout = game.bet;
    }
    if (payout > 0) {
      await this.award(game.guildId, game.userId, payout, "blackjack_win", `${game.guildId}:${game.userId}:blackjack:${game.startedAt}:win`);
    }
    game.result = result;
    game.payout = payout;
    game.status = "finished";
  }

  async blackjackStart(guildId: string, userId: string, bet: number): Promise<BlackjackGame> {
    const key = this.blackjackKey(guildId, userId);
    const existing = this.blackjackGames.get(key);
    if (existing && existing.status === "playing") throw new Error("BLACKJACK_ACTIVE");
    await this.spend(guildId, userId, bet, "blackjack_bet", `${guildId}:${userId}:blackjack:${Date.now()}`);
    const game: BlackjackGame = {
      guildId,
      userId,
      bet,
      player: [this.drawBlackjackCard(guildId), this.drawBlackjackCard(guildId)],
      dealer: [this.drawBlackjackCard(guildId), this.drawBlackjackCard(guildId)],
      status: "playing",
      startedAt: Date.now(),
    };
    this.blackjackGames.set(key, game);
    if (this.isBlackjack(game.player) || this.isBlackjack(game.dealer)) {
      await this.resolveBlackjack(game);
    }
    return game;
  }

  async blackjackHit(guildId: string, userId: string): Promise<BlackjackGame> {
    const key = this.blackjackKey(guildId, userId);
    const game = this.blackjackGames.get(key);
    if (!game) throw new Error("NO_BLACKJACK_GAME");
    if (game.status !== "playing") throw new Error("BLACKJACK_FINISHED");
    game.player.push(this.drawBlackjackCard(guildId));
    if (this.handValue(game.player) > 21) {
      await this.resolveBlackjack(game);
    }
    return game;
  }

  async blackjackStand(guildId: string, userId: string): Promise<BlackjackGame> {
    const key = this.blackjackKey(guildId, userId);
    const game = this.blackjackGames.get(key);
    if (!game) throw new Error("NO_BLACKJACK_GAME");
    if (game.status !== "playing") throw new Error("BLACKJACK_FINISHED");
    while (this.handValue(game.dealer) < 17) {
      game.dealer.push(this.drawBlackjackCard(guildId));
    }
    await this.resolveBlackjack(game);
    return game;
  }

  blackjackPayload(game: BlackjackGame): ReplyPayload & { attachments: [] } {
    const reveal = game.status === "finished";
    const dealerCards = reveal ? game.dealer.join(" ") : `${game.dealer[0]} ??`;
    const playerValue = this.handValue(game.player);
    const dealerValue = reveal ? this.handValue(game.dealer) : this.cardValue(game.dealer[0]!);
    const lines = [
      `**Your hand** · ${game.player.join(" ")} (${playerValue})`,
      `**Dealer** · ${dealerCards}${reveal ? ` (${dealerValue})` : ""}`,
    ];
    if (game.status === "finished" && game.result) {
      lines.push("", game.result);
      if (game.payout && game.payout > 0) lines.push(`Payout: ${game.payout} SC`);
    }
    return { ...card({
      theme: "economy",
      eyebrow: "THE CARD ROOM",
      image: { name: "blackjack-table.png", description: lines.join(" ").slice(0, 1024) },
      footer: false,
      rows: game.status === "playing"
        ? [
            actionRow(
              new ButtonBuilder().setCustomId(`economy:bj:hit:${game.userId}`).setLabel("Hit").setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId(`economy:bj:stand:${game.userId}`).setLabel("Stand").setStyle(ButtonStyle.Secondary),
            ),
          ]
        : [],
    }), files: [new AttachmentBuilder(renderBlackjackTable(game), { name: "blackjack-table.png" })], attachments: [] };
  }

  async handleBlackjackInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.isButton()) return;
    const parts = interaction.customId.split(":");
    if (parts[0] !== "economy" || parts[1] !== "bj") return;
    const action = parts[2];
    const userId = parts[3];
    if (!userId || interaction.user.id !== userId) {
      await interaction.reply(styleMessage({ content: "This is not your hand.", ephemeral: true })).catch(() => undefined);
      return;
    }
    const guildId = interaction.guild?.id;
    if (!guildId) return;
    try {
      let game: BlackjackGame;
      if (action === "hit") game = await this.blackjackHit(guildId, userId);
      else if (action === "stand") game = await this.blackjackStand(guildId, userId);
      else return;
      await interaction.update(styleMessage(this.blackjackPayload(game)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Blackjack failed.";
      await interaction.reply(styleMessage({ content: message, ephemeral: true })).catch(() => undefined);
    }
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
