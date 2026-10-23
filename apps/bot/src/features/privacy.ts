import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  memberActivity,
  economyAccounts,
  economyHoldings,
  economyInventory,
  economyTransactions,
  familyChildren,
  familyMarriages,
  friendshipLevels,
  interactionCounters,
  interactionOptouts,
  premiumPasses,
  relicAuctions,
  relicBids,
  relicCards,
  relicInventory,
  relicProfiles,
  relicTrades,
  tempVoiceChannels,
  userBiases,
  userBirthdays,
  type Database,
} from "@siela/db";
import type { ActivityService } from "./activity.js";
import type { CounterService } from "./counters.js";
import type { EconomyService } from "./economy.js";
import type { FriendshipService } from "./friendship.js";

export class PrivacyService {
  constructor(
    private readonly db: Database,
    private readonly counters: CounterService,
    private readonly economy: EconomyService | null = null,
    private readonly activity: ActivityService | null = null,
    private readonly friendship: FriendshipService | null = null,
  ) {}

  async deleteUserData(guildId: string, userId: string): Promise<void> {
    await this.activity?.flush().catch(() => undefined);
    await this.friendship?.flush().catch(() => undefined);

    const refundedProposers = await this.db.transaction(async (tx) => {
      await tx.delete(interactionCounters).where(
        and(
          eq(interactionCounters.guildId, guildId),
          or(eq(interactionCounters.actorId, userId), eq(interactionCounters.targetId, userId))!,
        ),
      );
      await tx.delete(interactionOptouts).where(and(eq(interactionOptouts.guildId, guildId), eq(interactionOptouts.userId, userId)));
      await tx.delete(userBiases).where(and(eq(userBiases.guildId, guildId), eq(userBiases.userId, userId)));
      await tx.delete(userBirthdays).where(and(eq(userBirthdays.guildId, guildId), eq(userBirthdays.userId, userId)));
      await tx.delete(familyMarriages).where(and(eq(familyMarriages.guildId, guildId), or(eq(familyMarriages.spouseA, userId), eq(familyMarriages.spouseB, userId))!));
      await tx.delete(familyChildren).where(and(eq(familyChildren.guildId, guildId), or(eq(familyChildren.parentId, userId), eq(familyChildren.childId, userId))!));
      await tx.delete(friendshipLevels).where(and(eq(friendshipLevels.guildId, guildId), or(eq(friendshipLevels.userA, userId), eq(friendshipLevels.userB, userId))!));
      await tx.delete(memberActivity).where(and(eq(memberActivity.guildId, guildId), eq(memberActivity.userId, userId)));
      await tx.delete(tempVoiceChannels).where(and(eq(tempVoiceChannels.guildId, guildId), eq(tempVoiceChannels.ownerId, userId)));

      const refundedProposers: string[] = [];
      const trades = await tx
        .select({
          id: relicTrades.id,
          proposerId: relicTrades.proposerId,
          status: relicTrades.status,
          coins: relicTrades.coins,
        })
        .from(relicTrades)
        .where(
          and(
            eq(relicTrades.guildId, guildId),
            or(eq(relicTrades.proposerId, userId), eq(relicTrades.partnerId, userId))!,
          ),
        );
      for (const trade of trades) {
        if (trade.status !== "pending" || trade.coins <= 0 || trade.proposerId === userId) continue;
        const refunded = await tx
          .update(economyAccounts)
          .set({ balance: sql`${economyAccounts.balance} + ${trade.coins}`, updatedAt: new Date() })
          .where(
            and(
              eq(economyAccounts.guildId, guildId),
              eq(economyAccounts.userId, trade.proposerId),
            ),
          )
          .returning({ userId: economyAccounts.userId });
        if (!refunded.length) continue;
        await tx.insert(economyTransactions).values({
          guildId,
          toUserId: trade.proposerId,
          amount: trade.coins,
          kind: "relic_trade_refund",
          reason: `trade ${trade.id} refunded after counterparty privacy deletion`,
        });
        refundedProposers.push(trade.proposerId);
      }
      if (trades.length) {
        await tx
          .update(relicInventory)
          .set({ lockedTradeId: null })
          .where(inArray(relicInventory.lockedTradeId, trades.map((trade) => trade.id)));
      }
      await tx.delete(relicTrades).where(
        and(
          eq(relicTrades.guildId, guildId),
          or(eq(relicTrades.proposerId, userId), eq(relicTrades.partnerId, userId))!,
        ),
      );
      await tx.delete(relicBids).where(and(eq(relicBids.guildId, guildId), eq(relicBids.userId, userId)));
      await tx
        .update(relicAuctions)
        .set({ highestBid: 0, highestBidderId: null, bidCount: 0 })
        .where(
          and(
            eq(relicAuctions.guildId, guildId),
            eq(relicAuctions.status, "live"),
            eq(relicAuctions.highestBidderId, userId),
          ),
        );
      await tx.delete(relicInventory).where(and(eq(relicInventory.guildId, guildId), eq(relicInventory.userId, userId)));
      await tx.delete(relicProfiles).where(and(eq(relicProfiles.guildId, guildId), eq(relicProfiles.userId, userId)));
      await tx
        .update(relicCards)
        .set({ ownerId: null, acquiredVia: null })
        .where(and(eq(relicCards.guildId, guildId), eq(relicCards.ownerId, userId)));
      await tx
        .update(relicAuctions)
        .set({ winnerId: null, highestBidderId: null })
        .where(and(eq(relicAuctions.guildId, guildId), eq(relicAuctions.winnerId, userId)));
      await tx
        .update(relicAuctions)
        .set({ highestBidderId: null })
        .where(and(eq(relicAuctions.guildId, guildId), eq(relicAuctions.highestBidderId, userId)));

      await tx.delete(economyAccounts).where(and(eq(economyAccounts.guildId, guildId), eq(economyAccounts.userId, userId)));
      await tx.delete(economyHoldings).where(and(eq(economyHoldings.guildId, guildId), eq(economyHoldings.userId, userId)));
      await tx.delete(economyTransactions).where(and(eq(economyTransactions.guildId, guildId), or(eq(economyTransactions.fromUserId, userId), eq(economyTransactions.toUserId, userId))!));
      await tx.delete(premiumPasses).where(and(eq(premiumPasses.guildId, guildId), eq(premiumPasses.userId, userId)));
      await tx.delete(economyInventory).where(and(eq(economyInventory.guildId, guildId), eq(economyInventory.userId, userId)));
      return refundedProposers;
    });

    if (this.economy) {
      for (const proposerId of new Set(refundedProposers)) {
        await this.economy.invalidateBalance(guildId, proposerId).catch(() => undefined);
      }
      await this.economy.deleteUserData(guildId, userId).catch(() => undefined);
    }
  }
}
