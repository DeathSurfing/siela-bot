import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import {
  economyAccounts,
  economyTransactions,
  premiumPasses,
  economyShopItems,
  economyInventory,
  type Database,
} from "@siela/db";
import type { Logger } from "../lib/logger.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder } from "discord.js";
import type { ValkeyService } from "./valkey.js";

const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const STREAK_WINDOW_MS = 36 * 60 * 60 * 1000;
const DAILY_BASE = 10;

export interface EconomyBalance {
  balance: number;
  lastDailyAt: Date | null;
  dailyStreak: number;
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
          const parsed = JSON.parse(cached) as EconomyBalance;
          if (parsed.lastDailyAt) parsed.lastDailyAt = new Date(parsed.lastDailyAt as string | Date);
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
        dailyStreak: economyAccounts.dailyStreak,
      })
      .from(economyAccounts)
      .where(and(eq(economyAccounts.guildId, guildId), eq(economyAccounts.userId, userId)));
    const result: EconomyBalance = {
      balance: row?.balance ?? 0,
      lastDailyAt: row?.lastDailyAt ? new Date(row.lastDailyAt as string | Date) : null,
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
      const lastDaily = current.lastDailyAt ? new Date(current.lastDailyAt as string | Date) : null;
      const nextAt = lastDaily
        ? new Date(lastDaily.getTime() + DAILY_COOLDOWN_MS)
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
    const item = await this.getShopItem(guildId, key.toLowerCase());
    if (!item) throw new Error("ITEM_NOT_FOUND");
    if (item.stock !== null && item.stock <= 0) throw new Error("OUT_OF_STOCK");

    await this.spend(guildId, userId, item.price, "shop_purchase", `shop:${guildId}:${userId}:${item.key}:${Date.now()}`);

    if (item.stock !== null) {
      await this.db
        .update(economyShopItems)
        .set({ stock: item.stock - 1 })
        .where(and(eq(economyShopItems.guildId, guildId), eq(economyShopItems.key, item.key)));
    }

    await this.db
      .insert(economyInventory)
      .values({ guildId, userId, itemKey: item.key, quantity: 1 })
      .onConflictDoUpdate({
        target: [economyInventory.guildId, economyInventory.userId, economyInventory.itemKey],
        set: { quantity: sql`${economyInventory.quantity} + 1`, updatedAt: new Date() },
      });

    return { item, roleGranted: Boolean(item.roleId) };
  }

  async inventory(guildId: string, userId: string) {
    return this.db
      .select()
      .from(economyInventory)
      .where(and(eq(economyInventory.guildId, guildId), eq(economyInventory.userId, userId)));
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

  blackjackPayload(game: BlackjackGame): { components: any[]; flags: number } {
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
    const container = new ContainerBuilder().setAccentColor(0x5865f2);
    container.addTextDisplayComponents(new TextDisplayBuilder({ content: "## Blackjack" }));
    container.addTextDisplayComponents(new TextDisplayBuilder({ content: lines.join("\n") }));
    const components: any[] = [container];
    if (game.status === "playing") {
      components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`economy:bj:hit:${game.userId}`).setLabel("Hit").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`economy:bj:stand:${game.userId}`).setLabel("Stand").setStyle(ButtonStyle.Secondary),
      ));
    }
    return { components, flags: 4096 };
  }

  async handleBlackjackInteraction(interaction: any): Promise<void> {
    if (!interaction.isButton()) return;
    const parts = interaction.customId.split(":");
    if (parts[0] !== "economy" || parts[1] !== "bj") return;
    const action = parts[2];
    const userId = parts[3];
    if (!userId || interaction.user.id !== userId) {
      await interaction.reply({ content: "This is not your hand.", ephemeral: true }).catch(() => undefined);
      return;
    }
    const guildId = interaction.guild?.id;
    if (!guildId) return;
    try {
      let game: BlackjackGame;
      if (action === "hit") game = await this.blackjackHit(guildId, userId);
      else if (action === "stand") game = await this.blackjackStand(guildId, userId);
      else return;
      await interaction.update(this.blackjackPayload(game));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Blackjack failed.";
      await interaction.reply({ content: message, ephemeral: true }).catch(() => undefined);
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
