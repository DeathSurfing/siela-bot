import { and, eq, or } from "drizzle-orm";
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

    await this.db.transaction(async (tx) => {
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
      await tx.delete(economyAccounts).where(and(eq(economyAccounts.guildId, guildId), eq(economyAccounts.userId, userId)));
      await tx.delete(economyHoldings).where(and(eq(economyHoldings.guildId, guildId), eq(economyHoldings.userId, userId)));
      await tx.delete(economyTransactions).where(and(eq(economyTransactions.guildId, guildId), or(eq(economyTransactions.fromUserId, userId), eq(economyTransactions.toUserId, userId))!));
      await tx.delete(premiumPasses).where(and(eq(premiumPasses.guildId, guildId), eq(premiumPasses.userId, userId)));
      await tx.delete(economyInventory).where(and(eq(economyInventory.guildId, guildId), eq(economyInventory.userId, userId)));
    });

    if (this.economy) await this.economy.deleteUserData(guildId, userId).catch(() => undefined);
  }
}
