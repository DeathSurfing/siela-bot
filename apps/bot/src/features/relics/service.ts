import { styleMessage } from "../ui.js";
import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import type {
  ButtonInteraction,
  Client,
  Guild,
  MessageReaction,
  ModalSubmitInteraction,
  GuildTextBasedChannel,
  User,
} from "discord.js";
import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import {
  RELIC_RARITY_ORDER,
  RELIC_SUBJECTS,
  RELIC_TRADE_TTL_MS,
  RELIC_YIELD_CAP_DAYS,
  hashRelicSeed,
  isRelicWeekend,
  isValidRelicBid,
  nextRelicBid,
  relicDropWindow,
  relicSerialLabel,
  relicYieldPerDay,
  rollRelic,
  rollRelicStats,
  createRelicRng,
  type RelicFoil,
  type RelicRarity,
  type RelicSigil,
} from "@siela/shared";
import {
  economyAccounts,
  economyTransactions,
  relicAuctions,
  relicBids,
  relicCards,
  relicInventory,
  relicProfiles,
  relicSettings,
  relicTrades,
  type Database,
  type RelicAuctionRow,
  type RelicCardRow,
  type RelicInventoryRow,
  type RelicSettingsRow,
  type RelicTradeRow,
} from "@siela/db";
import type { Logger } from "../../lib/logger.js";
import type { AuditService } from "../audit.js";
import { card } from "../ui.js";
import type { ReplyPayload } from "../../framework/types.js";
import type { EconomyService } from "../economy.js";
import { renderRelicCard } from "./art.js";
import {
  asRelicRarity,
  buildAuctionPayload,
  buildAuctionResultPayload,
  buildCancelledAuctionPayload,
  buildCardPayload,
  buildInventoryPayload,
  buildLeaderboardPayload,
  buildProfilePayload,
  buildRulesPayload,
  buildTradePayload,
  formatSc,
  relicVariantName,
  type InventoryStats,
  type RelicProfileStats,
} from "./ui.js";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const MAX_BID = 1_000_000;
const MAX_TRADE_COINS = 1_000_000;
const PAGE_SIZE = 6;
const TICK_MS = 20_000;
const ART_CACHE_SIZE = 40;

export class RelicError extends Error {
  constructor(
    readonly code: string,
    message?: string,
    readonly meta: Record<string, number | string> = {},
  ) {
    super(message ?? code);
    this.name = "RelicError";
  }
}

export function relicErrorMessage(error: unknown): string {
  if (!(error instanceof RelicError)) return "Something went wrong in the relic vault.";
  switch (error.code) {
    case "NOT_CONFIGURED":
      return "Relic auctions are not configured yet. An admin can run `/relics channel`.";
    case "NO_CHANNEL":
      return "The auction channel is missing. An admin can set it with `/relics channel`.";
    case "NO_LIVE_AUCTION":
      return "There is no live relic auction right now.";
    case "AUCTION_LIVE":
      return "A relic auction is already live.";
    case "AUCTION_ENDED":
      return "This auction has already closed.";
    case "AUCTION_EXISTS":
      return "That auction slot already exists.";
    case "ALREADY_LEADING":
      return "You are already the highest bidder on this relic.";
    case "INSUFFICIENT_FUNDS":
      return "You do not have enough Siela Coins for that bid.";
    case "BID_TOO_LOW":
      return `The minimum bid is ${formatSc(Number(error.meta.min ?? 0))}.`;
    case "INVALID_AMOUNT":
      return "Enter a whole number of Siela Coins.";
    case "CARD_NOT_FOUND":
      return "That relic serial does not exist.";
    case "NOT_OWNER":
      return "You do not own that relic.";
    case "CARD_LOCKED":
      return "That relic is currently locked in another trade.";
    case "TRADE_NOT_FOUND":
      return "That trade offer no longer exists.";
    case "TRADE_NOT_PENDING":
      return "That trade offer is already resolved.";
    case "TRADE_EXPIRED":
      return "That trade offer has expired.";
    case "NOT_PARTICIPANT":
      return "Only the two traders can use that offer.";
    case "INVALID_TARGET":
      return "Choose another human member for this trade.";
    case "NOTHING_TO_COLLECT":
      return "Your relics have not generated enough coins yet. Try again later.";
    default:
      return "Something went wrong in the relic vault.";
  }
}

interface AuctionBundle {
  auction: RelicAuctionRow;
  card: RelicCardRow;
}

interface CollectionRow {
  card: RelicCardRow;
  inventory: RelicInventoryRow;
}

export class RelicService {
  private readonly guilds = new Map<string, Guild>();
  private timer: NodeJS.Timeout | null = null;
  private readonly ticking = new Set<string>();
  private readonly starting = new Set<string>();
  private readonly artCache = new Map<number, Buffer>();
  private readonly warnedDates = new Set<string>();
  private readonly announcing = new Set<number>();

  constructor(
    private readonly db: Database,
    private readonly client: Client,
    private readonly economy: EconomyService,
    private readonly audit: AuditService,
    private readonly logger: Logger,
  ) {}

  start(guild: Guild): void {
    this.guilds.set(guild.id, guild);
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    this.timer.unref?.();
    setTimeout(() => void this.tick(), 4_000).unref?.();
    this.logger.info({ guilds: this.guilds.size }, "relic scheduler started");
  }

  stop(guildId?: string): void {
    if (guildId) {
      this.guilds.delete(guildId);
      this.ticking.delete(guildId);
      this.starting.delete(guildId);
      if (this.guilds.size > 0) return;
    }
    this.guilds.clear();
    this.ticking.clear();
    this.starting.clear();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async getSettings(guildId: string): Promise<RelicSettingsRow> {
    await this.db.insert(relicSettings).values({ guildId }).onConflictDoNothing();
    const [row] = await this.db.select().from(relicSettings).where(eq(relicSettings.guildId, guildId));
    if (!row) throw new Error("Failed to load relic settings");
    return row;
  }

  async configureChannel(guildId: string, channelId: string, actorId: string): Promise<RelicSettingsRow> {
    await this.getSettings(guildId);
    const [row] = await this.db
      .update(relicSettings)
      .set({ channelId, enabled: true, updatedAt: new Date(), updatedBy: actorId })
      .where(eq(relicSettings.guildId, guildId))
      .returning();
    await this.audit.log({
      guildId,
      actorId,
      source: "discord",
      action: "relics.channel.set",
      targetType: "channel",
      targetId: channelId,
      after: { channelId, enabled: true },
    });
    return row!;
  }

  async setEnabled(guildId: string, enabled: boolean, actorId: string): Promise<RelicSettingsRow> {
    await this.getSettings(guildId);
    const [row] = await this.db
      .update(relicSettings)
      .set({ enabled, updatedAt: new Date(), updatedBy: actorId })
      .where(eq(relicSettings.guildId, guildId))
      .returning();
    await this.audit.log({
      guildId,
      actorId,
      source: "discord",
      action: enabled ? "relics.enable" : "relics.disable",
      targetType: "guild",
      targetId: guildId,
      after: { enabled },
    });
    return row!;
  }

  async setPingRole(guildId: string, roleId: string | null, actorId: string): Promise<RelicSettingsRow> {
    await this.getSettings(guildId);
    const [row] = await this.db
      .update(relicSettings)
      .set({ pingRoleId: roleId, updatedAt: new Date(), updatedBy: actorId })
      .where(eq(relicSettings.guildId, guildId))
      .returning();
    await this.audit.log({
      guildId,
      actorId,
      source: "discord",
      action: "relics.ping_role.set",
      targetType: "role",
      targetId: roleId,
      after: { pingRoleId: roleId },
    });
    return row!;
  }

  async getLiveAuction(guildId: string): Promise<RelicAuctionRow | null> {
    const [row] = await this.db
      .select()
      .from(relicAuctions)
      .where(and(eq(relicAuctions.guildId, guildId), eq(relicAuctions.status, "live")))
      .orderBy(desc(relicAuctions.id))
      .limit(1);
    return row ?? null;
  }

  async buildAuctionPayload(guildId: string, auctionId?: number): Promise<ReplyPayload | null> {
    const auction = auctionId
      ? (await this.db.select().from(relicAuctions).where(and(eq(relicAuctions.guildId, guildId), eq(relicAuctions.id, auctionId))).limit(1))[0]
      : await this.getLiveAuction(guildId);
    if (!auction) return null;
    const [card] = await this.db.select().from(relicCards).where(eq(relicCards.id, auction.cardId)).limit(1);
    if (!card) return null;
    const art = await this.cardArt(card);
    return buildAuctionPayload({ auction, card, art });
  }

  private async tick(): Promise<void> {
    for (const guild of this.guilds.values()) {
      if (this.ticking.has(guild.id)) continue;
      this.ticking.add(guild.id);
      try {
        await this.tickGuild(guild);
      } catch (error) {
        this.logger.warn({ err: error, guildId: guild.id }, "relic scheduler tick failed");
      } finally {
        this.ticking.delete(guild.id);
      }
    }
  }

  private async tickGuild(guild: Guild): Promise<void> {
    await this.settleDueAuctions(guild.id);
    await this.recoverSettlements(guild.id);
    await this.expireDueTrades(guild.id);
    const settings = await this.getSettings(guild.id);
    if (!settings.enabled || !settings.channelId) return;
    await this.maybeStartDaily(guild, settings);
  }

  private async maybeStartDaily(guild: Guild, settings: RelicSettingsRow): Promise<void> {
    if (this.starting.has(guild.id)) return;
    const now = new Date();
    const window = relicDropWindow(now, {
      startHourIst: settings.startHourIst,
      durationMinutes: settings.durationMinutes,
      startingBid: settings.startingBid,
      minIncrement: settings.minIncrement,
    });
    if (now.getTime() < window.start.getTime() || now.getTime() >= window.end.getTime()) return;
    const slot = `${window.dateKey}:daily`;
    const [existing] = await this.db
      .select({ id: relicAuctions.id })
      .from(relicAuctions)
      .where(and(eq(relicAuctions.guildId, guild.id), eq(relicAuctions.slot, slot)))
      .limit(1);
    if (existing) return;
    if (await this.getLiveAuction(guild.id)) return;
    const channel = await this.resolveChannel(guild, settings.channelId);
    if (!channel) {
      const warnKey = `${guild.id}:${window.dateKey}`;
      if (!this.warnedDates.has(warnKey)) {
        this.warnedDates.add(warnKey);
        this.logger.warn({ guildId: guild.id, channelId: settings.channelId }, "relic auction channel is unavailable");
      }
      return;
    }
    this.starting.add(guild.id);
    try {
      const bundle = await this.createAuction({
        guild,
        channel,
        settings,
        slot,
        dropDate: window.dateKey,
        startsAt: now,
        endsAt: window.end,
      });
      this.logger.info(
        { guildId: guild.id, auctionId: bundle.auction.id, cardId: bundle.card.id, rarity: bundle.card.rarity },
        "daily relic auction started",
      );
    } catch (error) {
      if (!(error instanceof RelicError && (error.code === "AUCTION_EXISTS" || error.code === "AUCTION_LIVE"))) {
        this.logger.error({ err: error, guildId: guild.id }, "failed to start daily relic auction");
      }
    } finally {
      this.starting.delete(guild.id);
    }
  }

  private async createAuction(input: {
    guild: Guild;
    channel: GuildTextBasedChannel;
    settings: RelicSettingsRow;
    slot: string;
    dropDate: string;
    startsAt: Date;
    endsAt: Date;
    rarity?: RelicRarity;
  }): Promise<AuctionBundle> {
    const card = await this.mintCard(input.guild.id, input.rarity, input.startsAt);
    let auction: RelicAuctionRow | undefined;
    try {
      [auction] = await this.db
        .insert(relicAuctions)
        .values({
          guildId: input.guild.id,
          cardId: card.id,
          channelId: input.channel.id,
          slot: input.slot,
          dropDate: input.dropDate,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          startingBid: input.settings.startingBid,
          minIncrement: input.settings.minIncrement,
        })
        .onConflictDoNothing({ target: [relicAuctions.guildId, relicAuctions.slot] })
        .returning();
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        await this.db.delete(relicCards).where(eq(relicCards.id, card.id)).catch(() => undefined);
        throw new RelicError("AUCTION_LIVE");
      }
      throw error;
    }
    if (!auction) {
      await this.db.delete(relicCards).where(eq(relicCards.id, card.id)).catch(() => undefined);
      throw new RelicError("AUCTION_EXISTS");
    }
    await this.db.update(relicCards).set({ auctionId: auction.id }).where(eq(relicCards.id, card.id));
    try {
      if (input.settings.pingRoleId) {
        await input.channel
          .send(styleMessage({
            content: `🔔 <@&${input.settings.pingRoleId}> — a new relic is up for auction.`,
            allowedMentions: { roles: [input.settings.pingRoleId] },
          }))
          .catch(() => undefined);
      }
      const payload = buildAuctionPayload({
        auction,
        card,
        art: await this.cardArt(card),
      });
      const message = await input.channel.send(styleMessage({
        components: payload.components,
        files: payload.files,
        flags: payload.flags,
      }));
      await this.db.update(relicAuctions).set({ messageId: message.id }).where(eq(relicAuctions.id, auction.id));
      await message.react("💰").catch(() => undefined);
      return { auction: { ...auction, messageId: message.id }, card };
    } catch (error) {
      await this.db
        .update(relicAuctions)
        .set({ status: "cancelled", settledAt: new Date() })
        .where(eq(relicAuctions.id, auction.id))
        .catch(() => undefined);
      throw error;
    }
  }

  private async mintCard(guildId: string, rarity?: RelicRarity, at = new Date()): Promise<RelicCardRow> {
    const recent = await this.db
      .select({ subjectKey: relicCards.subjectKey })
      .from(relicCards)
      .where(eq(relicCards.guildId, guildId))
      .orderBy(desc(relicCards.id))
      .limit(24);
    const excludeSubjectKeys = new Set(recent.map((row) => row.subjectKey));
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const seed = hashRelicSeed(`${guildId}:${randomUUID()}:${attempt}`);
      const roll = rollRelic({
        serial: 0,
        seed,
        weekend: isRelicWeekend(at),
        rarity,
        excludeSubjectKeys,
      });
      try {
        const row = await this.db.transaction(async (tx) => {
          const [inserted] = await tx
            .insert(relicCards)
            .values({
              guildId,
              subjectKey: roll.subject.key,
              name: roll.name,
              variantKey: roll.variant.key,
              rarity: roll.rarity,
              seed,
              power: roll.stats.power,
              chaos: roll.stats.chaos,
              luck: roll.stats.luck,
              aura: roll.stats.aura,
              rating: roll.stats.rating,
              lore: roll.subject.lore,
              emoji: roll.subject.emoji,
              palette: [...roll.subject.palette],
              sigil: roll.subject.sigil,
              foil: roll.variant.foil,
              isGenesis: false,
            })
            .returning();
          if (!inserted) return null;
          if (inserted.id > 10) return inserted;
          const genesisStats = rollRelicStats(
            roll.rarity,
            createRelicRng(hashRelicSeed(`${seed}:genesis`)),
            roll.variant,
            true,
          );
          const [updated] = await tx
            .update(relicCards)
            .set({
              power: genesisStats.power,
              chaos: genesisStats.chaos,
              luck: genesisStats.luck,
              aura: genesisStats.aura,
              rating: genesisStats.rating,
              isGenesis: true,
            })
            .where(eq(relicCards.id, inserted.id))
            .returning();
          return updated ?? inserted;
        });
        if (row) return row;
      } catch (error) {
        if ((error as { code?: string }).code === "23505") continue;
        throw error;
      }
    }
    throw new Error("Failed to mint a unique relic after several attempts");
  }

  private async cardArt(card: RelicCardRow): Promise<Buffer> {
    const cached = this.artCache.get(card.id);
    if (cached) {
      this.artCache.delete(card.id);
      this.artCache.set(card.id, cached);
      return cached;
    }
    const subject = RELIC_SUBJECTS.find((entry) => entry.key === card.subjectKey);
    const art = await renderRelicCard({
      serial: card.id,
      name: card.name,
      variantName: relicVariantName(card.variantKey),
      rarity: asRelicRarity(card.rarity),
      sigil: (card.sigil as RelicSigil) ?? "star",
      category: subject?.category ?? "internet",
      lore: card.lore,
      stats: {
        power: card.power,
        chaos: card.chaos,
        luck: card.luck,
        aura: card.aura,
        rating: card.rating,
      },
      palette: (card.palette.length === 3 ? card.palette : ["#0f172a", "#7c3aed", "#f8fafc"]) as [string, string, string],
      foil: (card.foil as RelicFoil) ?? "none",
      mintedAt: card.mintedAt,
      ownerName: null,
      isGenesis: card.isGenesis,
    });
    this.artCache.set(card.id, art);
    while (this.artCache.size > ART_CACHE_SIZE) {
      const oldest = this.artCache.keys().next().value;
      if (oldest === undefined) break;
      this.artCache.delete(oldest);
    }
    return art;
  }

  private async resolveChannel(guild: Guild, channelId: string | null): Promise<GuildTextBasedChannel | null> {
    if (!channelId) return null;
    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return null;
    if (!("guildId" in channel) || channel.guildId !== guild.id) return null;
    return channel as GuildTextBasedChannel;
  }

  async placeBid(input: {
    guildId: string;
    userId: string;
    auctionId: number;
    amount: number;
  }): Promise<{ amount: number; nextBid: number }> {
    const amount = input.amount;
    if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_BID) {
      throw new RelicError("INVALID_AMOUNT");
    }
    await this.economy.ensureAccount(input.guildId, input.userId);
    const now = new Date();
    let refundedBidderId: string | null = null;
    const result = await this.db.transaction(async (tx) => {
      const [auction] = await tx
        .select()
        .from(relicAuctions)
        .where(and(eq(relicAuctions.id, input.auctionId), eq(relicAuctions.guildId, input.guildId)))
        .for("update");
      if (!auction) throw new RelicError("NO_LIVE_AUCTION");
      if (auction.status !== "live" || auction.endsAt.getTime() <= now.getTime()) {
        throw new RelicError("AUCTION_ENDED");
      }
      if (auction.highestBidderId === input.userId) throw new RelicError("ALREADY_LEADING");
      refundedBidderId = auction.highestBidderId;
      const current = auction.highestBid > 0 ? auction.highestBid : null;
      const minimum = nextRelicBid(current, auction.startingBid, auction.minIncrement);
      if (!isValidRelicBid(amount, current, auction.startingBid, auction.minIncrement)) {
        throw new RelicError("BID_TOO_LOW", undefined, { min: minimum });
      }

      const debited = await tx
        .update(economyAccounts)
        .set({
          balance: sql`${economyAccounts.balance} - ${amount}`,
          totalSpent: sql`${economyAccounts.totalSpent} + ${amount}`,
          updatedAt: now,
        })
        .where(
          and(
            eq(economyAccounts.guildId, input.guildId),
            eq(economyAccounts.userId, input.userId),
            gte(economyAccounts.balance, amount),
          ),
        )
        .returning({ userId: economyAccounts.userId });
      if (!debited.length) throw new RelicError("INSUFFICIENT_FUNDS");

      const previousBids = await tx
        .select()
        .from(relicBids)
        .where(and(eq(relicBids.auctionId, auction.id), eq(relicBids.status, "active")))
        .for("update");
      for (const previous of previousBids) {
        await tx
          .update(relicBids)
          .set({ status: "outbid", updatedAt: now })
          .where(eq(relicBids.id, previous.id));
        const refunded = await tx
          .update(economyAccounts)
          .set({
            balance: sql`${economyAccounts.balance} + ${previous.amount}`,
            updatedAt: now,
          })
          .where(
            and(
              eq(economyAccounts.guildId, input.guildId),
              eq(economyAccounts.userId, previous.userId),
            ),
          )
          .returning({ userId: economyAccounts.userId });
        if (!refunded.length) throw new Error("Missing account for outbid refund");
        await tx.insert(economyTransactions).values({
          guildId: input.guildId,
          toUserId: previous.userId,
          amount: previous.amount,
          kind: "relic_outbid_refund",
          reason: `relic auction ${auction.id}`,
        });
      }

      await tx
        .insert(relicBids)
        .values({
          auctionId: auction.id,
          guildId: input.guildId,
          userId: input.userId,
          amount,
        })
        .returning({ id: relicBids.id });

      await tx
        .update(relicAuctions)
        .set({
          highestBid: amount,
          highestBidderId: input.userId,
          bidCount: sql`${relicAuctions.bidCount} + 1`,
        })
        .where(eq(relicAuctions.id, auction.id));

      await tx.insert(economyTransactions).values({
        guildId: input.guildId,
        fromUserId: input.userId,
        amount,
        kind: "relic_bid",
        reason: `relic auction ${auction.id}`,
      });

      return {
        amount,
        nextBid: nextRelicBid(amount, auction.startingBid, auction.minIncrement),
      };
    });

    await this.economy.invalidateBalance(input.guildId, input.userId);
    if (refundedBidderId && refundedBidderId !== input.userId) {
      await this.economy.invalidateBalance(input.guildId, refundedBidderId).catch(() => undefined);
    }
    await this.refreshAuctionMessage(input.auctionId).catch((error) =>
      this.logger.warn({ err: error, auctionId: input.auctionId }, "failed to refresh relic auction message"),
    );
    return result;
  }

  private async settleDueAuctions(guildId: string): Promise<void> {
    const now = new Date();
    const due = await this.db
      .select({ id: relicAuctions.id })
      .from(relicAuctions)
      .where(
        and(
          eq(relicAuctions.guildId, guildId),
          eq(relicAuctions.status, "live"),
          lte(relicAuctions.endsAt, now),
        ),
      )
      .limit(20);
    for (const row of due) {
      await this.settleAuction(row.id).catch((error) =>
        this.logger.error({ err: error, auctionId: row.id }, "failed to settle relic auction"),
      );
    }
  }

  async settleAuction(auctionId: number, force = false): Promise<RelicAuctionRow | null> {
    const settled = await this.db.transaction(async (tx) => {
      const [auction] = await tx
        .select()
        .from(relicAuctions)
        .where(eq(relicAuctions.id, auctionId))
        .for("update");
      if (!auction || auction.status !== "live") return null;
      const now = new Date();
      if (!force && auction.endsAt.getTime() > now.getTime()) return null;

      const active = await tx
        .select()
        .from(relicBids)
        .where(and(eq(relicBids.auctionId, auction.id), eq(relicBids.status, "active")))
        .orderBy(desc(relicBids.amount), asc(relicBids.createdAt));
      const winner = active[0] ?? null;
      for (const loser of active.slice(1)) {
        await tx.update(relicBids).set({ status: "outbid", updatedAt: now }).where(eq(relicBids.id, loser.id));
        const refunded = await tx
          .update(economyAccounts)
          .set({ balance: sql`${economyAccounts.balance} + ${loser.amount}`, updatedAt: now })
          .where(and(eq(economyAccounts.guildId, auction.guildId), eq(economyAccounts.userId, loser.userId)))
          .returning({ userId: economyAccounts.userId });
        if (!refunded.length) throw new Error("Missing account for settlement refund");
        await tx.insert(economyTransactions).values({
          guildId: auction.guildId,
          toUserId: loser.userId,
          amount: loser.amount,
          kind: "relic_outbid_refund",
          reason: `relic auction ${auction.id} settlement`,
        });
      }

      if (winner) {
        await tx.update(relicBids).set({ status: "won", updatedAt: now }).where(eq(relicBids.id, winner.id));
        await tx
          .update(relicCards)
          .set({
            ownerId: winner.userId,
            mintedAt: now,
            mintedPrice: winner.amount,
            acquiredVia: "auction",
          })
          .where(eq(relicCards.id, auction.cardId));
        const delivered = await tx
          .insert(relicInventory)
          .values({
            guildId: auction.guildId,
            userId: winner.userId,
            cardId: auction.cardId,
            acquiredVia: "auction",
            acquiredPrice: winner.amount,
            lastYieldAt: now,
          })
          .onConflictDoNothing()
          .returning({ id: relicInventory.id });
        if (!delivered.length) throw new Error("Relic card already has an inventory row");
      }

      const [row] = await tx
        .update(relicAuctions)
        .set({
          status: "settled",
          winnerId: winner?.userId ?? null,
          winningBid: winner?.amount ?? null,
          winningBidId: winner?.id ?? null,
          settledAt: now,
        })
        .where(eq(relicAuctions.id, auction.id))
        .returning();
      return row ?? null;
    });

    if (settled && settled.winnerId) {
      this.artCache.delete(settled.cardId);
      await this.cardArt(await this.getCard(settled.guildId, settled.cardId)).catch((error) =>
        this.logger.warn({ err: error, cardId: settled.cardId }, "failed to render relic art at mint"),
      );
    }
    if (settled) {
      await this.announceSettlement(settled.id).catch((error) =>
        this.logger.warn({ err: error, auctionId: settled.id }, "failed to announce relic settlement"),
      );
    }
    return settled;
  }

  private async recoverSettlements(guildId: string): Promise<void> {
    const cutoff = new Date(Date.now() - 2 * 86_400_000);
    const rows = await this.db
      .select({ id: relicAuctions.id })
      .from(relicAuctions)
      .where(
        and(
          eq(relicAuctions.guildId, guildId),
          eq(relicAuctions.status, "settled"),
          isNull(relicAuctions.announcedAt),
          gte(relicAuctions.settledAt, cutoff),
        ),
      )
      .limit(10);
    for (const row of rows) {
      await this.announceSettlement(row.id).catch((error) =>
        this.logger.warn({ err: error, auctionId: row.id }, "failed to recover relic settlement announcement"),
      );
    }
  }

  private async announceSettlement(auctionId: number): Promise<void> {
    if (this.announcing.has(auctionId)) return;
    this.announcing.add(auctionId);
    try {
      const [row] = await this.db
        .select({ auction: relicAuctions, card: relicCards })
        .from(relicAuctions)
        .innerJoin(relicCards, eq(relicCards.id, relicAuctions.cardId))
        .where(eq(relicAuctions.id, auctionId))
        .limit(1);
      if (!row || row.auction.announcedAt) return;
      const art = await this.cardArt(row.card);
      const payload = buildAuctionResultPayload({
        auction: row.auction,
        card: row.card,
        art,
        winnerId: row.auction.winnerId,
      });
      const guild = await this.client.guilds.fetch(row.auction.guildId).catch(() => null);
      if (!guild) return;
      const channel = await this.resolveChannel(guild, row.auction.channelId);
      if (!channel) return;
      let delivered = false;
      if (row.auction.messageId) {
        const message = await channel.messages.fetch(row.auction.messageId).catch(() => null);
        if (message) {
          const edited = await message
            .edit(styleMessage({
              components: payload.components,
              files: payload.files,
              flags: payload.flags,
              attachments: [],
            }))
            .then(() => true)
            .catch(() => false);
          delivered = edited;
        }
      }
      if (!delivered) {
        const sent = await channel
          .send(styleMessage({ components: payload.components, files: payload.files, flags: payload.flags }))
          .then(() => true)
          .catch(() => false);
        delivered = sent;
      }
      if (row.auction.winnerId) {
        const pinged = await channel
          .send(styleMessage({
            content: `🏆 <@${row.auction.winnerId}> won **${row.card.name}** (${relicSerialLabel(row.card.id)}) for ${formatSc(row.auction.winningBid ?? 0)}.`,
            allowedMentions: { users: [row.auction.winnerId] },
          }))
          .then(() => true)
          .catch(() => false);
        delivered = delivered || pinged;
      }
      if (delivered) {
        await this.db
          .update(relicAuctions)
          .set({ announcedAt: new Date() })
          .where(and(eq(relicAuctions.id, auctionId), isNull(relicAuctions.announcedAt)));
      }
    } finally {
      this.announcing.delete(auctionId);
    }
  }

  async startAuctionNow(guild: Guild, minutes?: number): Promise<RelicAuctionRow> {
    const settings = await this.getSettings(guild.id);
    if (!settings.channelId) throw new RelicError("NO_CHANNEL");
    const channel = await this.resolveChannel(guild, settings.channelId);
    if (!channel) throw new RelicError("NO_CHANNEL");
    if (await this.getLiveAuction(guild.id)) throw new RelicError("AUCTION_LIVE");
    const now = new Date();
    const duration = Math.max(1, Math.min(180, Math.floor(minutes ?? settings.durationMinutes)));
    const window = relicDropWindow(now, {
      startHourIst: settings.startHourIst,
      durationMinutes: settings.durationMinutes,
      startingBid: settings.startingBid,
      minIncrement: settings.minIncrement,
    });
    const bundle = await this.createAuction({
      guild,
      channel,
      settings,
      slot: `${window.dateKey}:bonus:${now.getTime()}`,
      dropDate: window.dateKey,
      startsAt: now,
      endsAt: new Date(now.getTime() + duration * 60_000),
    });
    await this.audit.log({
      guildId: guild.id,
      actorId: null,
      actorType: "system",
      source: "system",
      action: "relics.auction.force_start",
      targetType: "relic_auction",
      targetId: String(bundle.auction.id),
      after: { cardId: bundle.card.id, rarity: bundle.card.rarity, duration },
    });
    return bundle.auction;
  }

  async endAuctionNow(guildId: string, actorId: string): Promise<RelicAuctionRow | null> {
    const live = await this.getLiveAuction(guildId);
    if (!live) throw new RelicError("NO_LIVE_AUCTION");
    const settled = await this.settleAuction(live.id, true);
    await this.audit.log({
      guildId,
      actorId,
      source: "discord",
      action: "relics.auction.end",
      targetType: "relic_auction",
      targetId: String(live.id),
    });
    return settled;
  }

  async cancelAuctionNow(guildId: string, actorId: string): Promise<RelicAuctionRow | null> {
    const result = await this.db.transaction(async (tx) => {
      const [auction] = await tx
        .select()
        .from(relicAuctions)
        .where(and(eq(relicAuctions.guildId, guildId), eq(relicAuctions.status, "live")))
        .orderBy(desc(relicAuctions.id))
        .limit(1)
        .for("update");
      if (!auction) throw new RelicError("NO_LIVE_AUCTION");
      const now = new Date();
      const active = await tx
        .select()
        .from(relicBids)
        .where(and(eq(relicBids.auctionId, auction.id), eq(relicBids.status, "active")));
      for (const bid of active) {
        await tx.update(relicBids).set({ status: "cancelled", updatedAt: now }).where(eq(relicBids.id, bid.id));
        const refunded = await tx
          .update(economyAccounts)
          .set({ balance: sql`${economyAccounts.balance} + ${bid.amount}`, updatedAt: now })
          .where(and(eq(economyAccounts.guildId, guildId), eq(economyAccounts.userId, bid.userId)))
          .returning({ userId: economyAccounts.userId });
        if (!refunded.length) throw new Error("Missing account for auction cancel refund");
        await tx.insert(economyTransactions).values({
          guildId,
          toUserId: bid.userId,
          amount: bid.amount,
          kind: "relic_auction_cancelled_refund",
          reason: `relic auction ${auction.id}`,
        });
      }
      const [row] = await tx
        .update(relicAuctions)
        .set({ status: "cancelled", settledAt: now })
        .where(eq(relicAuctions.id, auction.id))
        .returning();
      return { row: row ?? null, bidders: active.map((bid) => bid.userId) };
    });
    if (result.row) {
      for (const bidder of new Set(result.bidders)) {
        await this.economy.invalidateBalance(guildId, bidder).catch(() => undefined);
      }
      await this.editCancelledMessage(result.row).catch(() => undefined);
      await this.audit.log({
        guildId,
        actorId,
        source: "discord",
        action: "relics.auction.cancel",
        targetType: "relic_auction",
        targetId: String(result.row.id),
      });
    }
    return result.row;
  }

  private async editCancelledMessage(auction: RelicAuctionRow): Promise<void> {
    const [card] = await this.db.select().from(relicCards).where(eq(relicCards.id, auction.cardId)).limit(1);
    if (!card) return;
    const guild = await this.client.guilds.fetch(auction.guildId).catch(() => null);
    if (!guild) return;
    const channel = await this.resolveChannel(guild, auction.channelId);
    if (!channel || !auction.messageId) return;
    const message = await channel.messages.fetch(auction.messageId).catch(() => null);
    if (!message) return;
    const payload = buildCancelledAuctionPayload(auction, card);
    await message
      .edit(styleMessage({ components: payload.components, files: payload.files, flags: payload.flags, attachments: [] }))
      .catch(() => undefined);
  }

  private async refreshAuctionMessage(auctionId: number): Promise<void> {
    const [row] = await this.db
      .select({ auction: relicAuctions, card: relicCards })
      .from(relicAuctions)
      .innerJoin(relicCards, eq(relicCards.id, relicAuctions.cardId))
      .where(eq(relicAuctions.id, auctionId))
      .limit(1);
    if (!row || !row.auction.messageId) return;
    const guild = await this.client.guilds.fetch(row.auction.guildId).catch(() => null);
    if (!guild) return;
    const channel = await this.resolveChannel(guild, row.auction.channelId);
    if (!channel) return;
    const message = await channel.messages.fetch(row.auction.messageId).catch(() => null);
    if (!message) return;
    const payload = buildAuctionPayload({
      auction: row.auction,
      card: row.card,
      art: await this.cardArt(row.card),
    });
    await message.edit(styleMessage({
      components: payload.components,
      files: payload.files,
      flags: payload.flags,
      attachments: [],
    }));
  }

  async handleReaction(reaction: MessageReaction, user: User): Promise<void> {
    if (user.bot) return;
    if (reaction.emoji.name !== "💰") return;
    const [auction] = await this.db
      .select()
      .from(relicAuctions)
      .where(and(eq(relicAuctions.messageId, reaction.message.id), eq(relicAuctions.status, "live")))
      .limit(1);
    if (!auction) return;
    if (auction.endsAt.getTime() <= Date.now()) return;
    if (auction.highestBidderId === user.id) {
      await user.send(styleMessage({ content: "You are already the highest bidder on that relic." })).catch(() => undefined);
      await reaction.users.remove(user.id).catch(() => undefined);
      return;
    }
    const amount = nextRelicBid(
      auction.highestBid > 0 ? auction.highestBid : null,
      auction.startingBid,
      auction.minIncrement,
    );
    try {
      await this.placeBid({ guildId: auction.guildId, userId: user.id, auctionId: auction.id, amount });
    } catch (error) {
      const message = relicErrorMessage(error);
      await user.send(styleMessage({ content: `Relic bid failed: ${message}` })).catch(() => undefined);
    } finally {
      await reaction.users.remove(user.id).catch(() => undefined);
    }
  }

  async handleInteraction(interaction: ButtonInteraction | ModalSubmitInteraction): Promise<void> {
    if (!interaction.guildId) return;
    const parts = interaction.customId.split(":");
    try {
      if (parts[1] === "bid" && interaction.isButton()) {
        const auctionId = Number(parts[2]);
        const auction = await this.requireLiveAuction(interaction.guildId, auctionId);
        const amount = nextRelicBid(
          auction.highestBid > 0 ? auction.highestBid : null,
          auction.startingBid,
          auction.minIncrement,
        );
        await interaction.deferReply({ ephemeral: true });
        const result = await this.placeBid({
          guildId: interaction.guildId,
          userId: interaction.user.id,
          auctionId,
          amount,
        });
        await interaction.editReply(styleMessage({
          content: `✅ You are the highest bidder at **${formatSc(result.amount)}**. Next minimum is ${formatSc(result.nextBid)}.`,
        }));
        return;
      }

      if (parts[1] === "bidmodal" && interaction.isButton()) {
        const auctionId = Number(parts[2]);
        await this.requireLiveAuction(interaction.guildId, auctionId);
        const modal = new ModalBuilder()
          .setCustomId(`relics:bidmodal:${auctionId}`)
          .setTitle("Custom relic bid")
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId("amount")
                .setLabel("Bid amount in Siela Coins")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(7),
            ),
          );
        await interaction.showModal(modal);
        return;
      }

      if (parts[1] === "bidmodal" && interaction.isModalSubmit()) {
        const auctionId = Number(parts[2]);
        const amount = Number(interaction.fields.getTextInputValue("amount").trim());
        await interaction.deferReply({ ephemeral: true });
        const result = await this.placeBid({
          guildId: interaction.guildId,
          userId: interaction.user.id,
          auctionId,
          amount,
        });
        await interaction.editReply(styleMessage({
          content: `✅ Bid placed at **${formatSc(result.amount)}**. You are the highest bidder.`,
        }));
        return;
      }

      if (parts[1] === "mine" && interaction.isButton()) {
        const auctionId = Number(parts[2]);
        await interaction.deferReply({ ephemeral: true });
        const auction = await this.requireLiveAuction(interaction.guildId, auctionId);
        const balance = await this.economy.getBalance(interaction.guildId, interaction.user.id);
        const [lastBid] = await this.db
          .select()
          .from(relicBids)
          .where(and(eq(relicBids.auctionId, auctionId), eq(relicBids.userId, interaction.user.id)))
          .orderBy(desc(relicBids.id))
          .limit(1);
        const next = nextRelicBid(
          auction.highestBid > 0 ? auction.highestBid : null,
          auction.startingBid,
          auction.minIncrement,
        );
        const standing =
          auction.highestBidderId === interaction.user.id
            ? `You are **leading** at ${formatSc(auction.highestBid)}.`
            : lastBid
              ? `Your last bid was ${formatSc(lastBid.amount)} and it was outbid.`
              : "You have not bid on this relic.";
        await interaction.editReply(styleMessage({
          content: `**Balance** · ${formatSc(balance.balance)}\n${standing}\n**Next minimum** · ${formatSc(next)}`,
        }));
        return;
      }

      if (parts[1] === "card" && interaction.isButton()) {
        const serial = Number(parts[2]);
        await interaction.deferReply();
        const payload = await this.cardPayload(interaction.guildId, serial, interaction.user.id);
        await interaction.editReply(styleMessage(payload));
        return;
      }

      if (parts[1] === "inv" && interaction.isButton()) {
        const userId = parts[2] ?? "";
        const page = Number(parts[3] ?? 0);
        const payload = await this.inventoryPayload(interaction.guildId, userId, page);
        await interaction.update(styleMessage({ components: payload.components, files: payload.files, flags: payload.flags }));
        return;
      }

      if (parts[1] === "profile" && interaction.isButton()) {
        const userId = parts[2] ?? interaction.user.id;
        await interaction.deferReply();
        const payload = await this.profilePayload(interaction.guildId, userId);
        await interaction.editReply(styleMessage(payload));
        return;
      }

      if (parts[1] === "top" && interaction.isButton()) {
        await interaction.deferReply();
        const payload = await this.leaderboardPayload(interaction.guildId);
        await interaction.editReply(styleMessage(payload));
        return;
      }

      if (parts[1] === "rules" && interaction.isButton()) {
        await interaction.reply(styleMessage({ ...buildRulesPayload(), ephemeral: true }));
        return;
      }

      if (parts[1] === "auction" && interaction.isButton()) {
        await interaction.deferReply();
        const payload = await this.buildAuctionPayload(interaction.guildId);
        if (payload) {
          await interaction.editReply(styleMessage(payload));
        } else {
          const settings = await this.getSettings(interaction.guildId);
          const next = relicDropWindow(new Date(), {
            startHourIst: settings.startHourIst,
            durationMinutes: settings.durationMinutes,
            startingBid: settings.startingBid,
            minIncrement: settings.minIncrement,
          });
          await interaction.editReply(
            styleMessage(card({
              title: "No relic is live",
              body: [
                settings.enabled && settings.channelId
                  ? `The next auction starts in <#${settings.channelId}> at **${settings.startHourIst}:00 IST** daily.`
                  : "Relic auctions are not configured yet. An admin can run `/relics channel`.",
                `Next window opens <t:${Math.floor(next.start.getTime() / 1000)}:R>.`,
              ].join("\n"),
            })),
          );
        }
        return;
      }

      if (parts[1] === "showcase" && interaction.isButton()) {
        const serial = Number(parts[2]);
        await interaction.deferReply({ ephemeral: true });
        const result = await this.setFeatured(interaction.guildId, interaction.user.id, serial);
        await interaction.editReply(styleMessage({
          content: `✅ ${result.card.emoji} **${result.card.name}** is now your featured relic.`,
        }));
        return;
      }

      if (parts[1] === "trade" && interaction.isButton()) {
        const action = parts[2];
        const tradeId = Number(parts[3]);
        await interaction.deferReply({ ephemeral: true });
        if (action === "accept") {
          await this.acceptTrade(interaction.guildId, tradeId, interaction.user.id);
          await interaction.editReply(styleMessage({ content: "✅ Trade accepted. Both relics have moved." }));
          return;
        }
        if (action === "decline") {
          await this.declineTrade(interaction.guildId, tradeId, interaction.user.id);
          await interaction.editReply(styleMessage({ content: "Trade declined. Any escrowed coins were returned." }));
          return;
        }
      }
    } catch (error) {
      const content = relicErrorMessage(error);
      if (interaction.deferred) {
        await interaction.editReply(styleMessage({ content })).catch(() => undefined);
      } else if (interaction.replied) {
        await interaction.followUp(styleMessage({ content, ephemeral: true })).catch(() => undefined);
      } else {
        await interaction.reply(styleMessage({ content, ephemeral: true })).catch(() => undefined);
      }
    }
  }

  private async requireLiveAuction(guildId: string, auctionId: number): Promise<RelicAuctionRow> {
    const [auction] = await this.db
      .select()
      .from(relicAuctions)
      .where(and(eq(relicAuctions.guildId, guildId), eq(relicAuctions.id, auctionId)))
      .limit(1);
    if (!auction) throw new RelicError("NO_LIVE_AUCTION");
    if (auction.status !== "live" || auction.endsAt.getTime() <= Date.now()) {
      throw new RelicError("AUCTION_ENDED");
    }
    return auction;
  }

  async getCard(guildId: string, serial: number): Promise<RelicCardRow> {
    const [cardRow] = await this.db
      .select()
      .from(relicCards)
      .where(and(eq(relicCards.guildId, guildId), eq(relicCards.id, serial)))
      .limit(1);
    if (!cardRow) throw new RelicError("CARD_NOT_FOUND");
    return cardRow;
  }

  async cardPayload(guildId: string, serial: number, viewerId: string): Promise<ReplyPayload> {
    const cardRow = await this.getCard(guildId, serial);
    const art = await this.cardArt(cardRow);
    return buildCardPayload({
      card: cardRow,
      art,
      ownerId: cardRow.ownerId,
      showShowcase: cardRow.ownerId === viewerId,
    });
  }

  private async collectionRows(guildId: string, userId: string): Promise<CollectionRow[]> {
    const rows = await this.db
      .select({ card: relicCards, inventory: relicInventory })
      .from(relicInventory)
      .innerJoin(relicCards, eq(relicCards.id, relicInventory.cardId))
      .where(and(eq(relicInventory.guildId, guildId), eq(relicInventory.userId, userId)));
    return rows.sort((a, b) => b.card.rating - a.card.rating || b.card.id - a.card.id);
  }

  private statsFor(rows: CollectionRow[]): InventoryStats {
    const rarityCounts = Object.fromEntries(RELIC_RARITY_ORDER.map((rarity) => [rarity, 0])) as Record<
      RelicRarity,
      number
    >;
    let rating = 0;
    let yieldPerDay = 0;
    let auctionWins = 0;
    for (const row of rows) {
      const rarity = asRelicRarity(row.card.rarity);
      rarityCounts[rarity] += 1;
      rating += row.card.rating;
      yieldPerDay += relicYieldPerDay(rarity, row.card.id);
      if (row.inventory.acquiredVia === "auction") auctionWins += 1;
    }
    return { cards: rows.length, rating, yieldPerDay, auctionWins, rarityCounts };
  }

  async inventoryPayload(guildId: string, userId: string, page = 0): Promise<ReplyPayload> {
    const rows = await this.collectionRows(guildId, userId);
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const safePage = Math.max(0, Math.min(pages - 1, Math.floor(page)));
    const entries = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE).map((row) => row.card);
    const profile = await this.getProfileRow(guildId, userId);
    const featured =
      profile?.featuredCardId != null
        ? rows.find((row) => row.card.id === profile.featuredCardId)?.card ?? null
        : null;
    const featuredArt = featured ? await this.cardArt(featured) : null;
    return buildInventoryPayload({
      userId,
      displayName: await this.displayName(guildId, userId),
      entries,
      total: rows.length,
      page: safePage,
      pages,
      stats: this.statsFor(rows),
      featured,
      featuredArt,
    });
  }

  private async getProfileRow(guildId: string, userId: string) {
    const [row] = await this.db
      .select()
      .from(relicProfiles)
      .where(and(eq(relicProfiles.guildId, guildId), eq(relicProfiles.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async setFeatured(
    guildId: string,
    userId: string,
    serial: number,
  ): Promise<{ card: RelicCardRow; inventory: RelicInventoryRow }> {
    const [row] = await this.db
      .select({ card: relicCards, inventory: relicInventory })
      .from(relicInventory)
      .innerJoin(relicCards, eq(relicCards.id, relicInventory.cardId))
      .where(
        and(
          eq(relicInventory.guildId, guildId),
          eq(relicInventory.userId, userId),
          eq(relicInventory.cardId, serial),
        ),
      )
      .limit(1);
    if (!row) throw new RelicError("NOT_OWNER");
    if (row.inventory.lockedTradeId != null) throw new RelicError("CARD_LOCKED");
    const now = new Date();
    await this.db
      .insert(relicProfiles)
      .values({ guildId, userId, featuredCardId: serial, updatedAt: now })
      .onConflictDoUpdate({
        target: [relicProfiles.guildId, relicProfiles.userId],
        set: { featuredCardId: serial, updatedAt: now },
      });
    return row;
  }

  async profilePayload(guildId: string, userId: string): Promise<ReplyPayload> {
    const rows = await this.collectionRows(guildId, userId);
    const stats = this.statsFor(rows);
    const profile = await this.getProfileRow(guildId, userId);
    const featured =
      profile?.featuredCardId != null
        ? rows.find((row) => row.card.id === profile.featuredCardId)?.card ?? null
        : null;
    const featuredArt = featured ? await this.cardArt(featured) : null;
    const topRarity =
      [...RELIC_RARITY_ORDER].reverse().find((rarity) => stats.rarityCounts[rarity] > 0) ?? null;
    const joinedAt = rows.length
      ? new Date(Math.min(...rows.map((row) => row.inventory.createdAt.getTime())))
      : profile?.createdAt ?? null;
    const profileStats: RelicProfileStats = {
      ...stats,
      yieldClaimed: profile?.totalYieldClaimed ?? 0,
      joinedAt,
      topRarity,
    };
    return buildProfilePayload({
      userId,
      displayName: await this.displayName(guildId, userId),
      stats: profileStats,
      featured,
      featuredArt,
    });
  }

  async leaderboardPayload(guildId: string): Promise<ReplyPayload> {
    const rows = await this.db
      .select({
        userId: relicInventory.userId,
        cards: sql<number>`count(*)::int`,
        rating: sql<number>`coalesce(sum(${relicCards.rating}), 0)::int`,
        wins: sql<number>`count(*) filter (where ${relicInventory.acquiredVia} = 'auction')::int`,
      })
      .from(relicInventory)
      .innerJoin(relicCards, eq(relicCards.id, relicInventory.cardId))
      .where(eq(relicInventory.guildId, guildId))
      .groupBy(relicInventory.userId)
      .orderBy(desc(sql`sum(${relicCards.rating})`), desc(sql`count(*)`))
      .limit(10);
    return buildLeaderboardPayload({
      entries: rows.map((row) => ({
        userId: row.userId,
        cards: Number(row.cards),
        rating: Number(row.rating),
        wins: Number(row.wins),
      })),
    });
  }

  async claimYield(guildId: string, userId: string): Promise<{ amount: number; cards: number }> {
    await this.economy.ensureAccount(guildId, userId);
    const now = new Date();
    const result = await this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ inventory: relicInventory, card: relicCards })
        .from(relicInventory)
        .innerJoin(relicCards, eq(relicCards.id, relicInventory.cardId))
        .where(and(eq(relicInventory.guildId, guildId), eq(relicInventory.userId, userId)))
        .for("update");
      let total = 0;
      let cards = 0;
      const ids: number[] = [];
      for (const row of rows) {
        const elapsedDays = Math.min(
          RELIC_YIELD_CAP_DAYS,
          Math.max(0, (now.getTime() - row.inventory.lastYieldAt.getTime()) / 86_400_000),
        );
        const amount = Math.floor(elapsedDays * relicYieldPerDay(asRelicRarity(row.card.rarity), row.card.id));
        if (amount > 0) {
          total += amount;
          cards += 1;
          ids.push(row.inventory.id);
        }
      }
      if (total <= 0 || !ids.length) throw new RelicError("NOTHING_TO_COLLECT");
      await tx.update(relicInventory).set({ lastYieldAt: now }).where(inArray(relicInventory.id, ids));
      await tx
        .update(economyAccounts)
        .set({
          balance: sql`${economyAccounts.balance} + ${total}`,
          totalEarned: sql`${economyAccounts.totalEarned} + ${total}`,
          updatedAt: now,
        })
        .where(and(eq(economyAccounts.guildId, guildId), eq(economyAccounts.userId, userId)));
      await tx.insert(economyTransactions).values({
        guildId,
        toUserId: userId,
        amount: total,
        kind: "relic_yield",
        reason: `${cards} relic${cards === 1 ? "" : "s"}`,
      });
      await tx
        .insert(relicProfiles)
        .values({ guildId, userId, totalYieldClaimed: total, updatedAt: now })
        .onConflictDoUpdate({
          target: [relicProfiles.guildId, relicProfiles.userId],
          set: {
            totalYieldClaimed: sql`${relicProfiles.totalYieldClaimed} + ${total}`,
            updatedAt: now,
          },
        });
      return { amount: total, cards };
    });
    await this.economy.invalidateBalance(guildId, userId);
    return result;
  }

  async createTrade(input: {
    guild: Guild;
    channel: GuildTextBasedChannel;
    proposerId: string;
    partnerId: string;
    offerSerial: number;
    requestSerial: number | null;
    coins: number;
  }): Promise<RelicTradeRow> {
    if (input.proposerId === input.partnerId) throw new RelicError("INVALID_TARGET");
    const coins = input.coins;
    if (!Number.isInteger(coins) || coins < 0 || coins > MAX_TRADE_COINS) throw new RelicError("INVALID_AMOUNT");
    if (coins > 0) await this.economy.ensureAccount(input.guild.id, input.proposerId);
    await this.economy.ensureAccount(input.guild.id, input.partnerId);

    const trade = await this.db.transaction(async (tx) => {
      const [offer] = await tx
        .select({ card: relicCards, inventory: relicInventory })
        .from(relicInventory)
        .innerJoin(relicCards, eq(relicCards.id, relicInventory.cardId))
        .where(
          and(
            eq(relicInventory.guildId, input.guild.id),
            eq(relicInventory.userId, input.proposerId),
            eq(relicInventory.cardId, input.offerSerial),
          ),
        )
        .for("update");
      if (!offer) throw new RelicError("NOT_OWNER");
      if (offer.inventory.lockedTradeId != null) throw new RelicError("CARD_LOCKED");

      if (input.requestSerial != null) {
        const [request] = await tx
          .select({ inventory: relicInventory })
          .from(relicInventory)
          .where(
            and(
              eq(relicInventory.guildId, input.guild.id),
              eq(relicInventory.userId, input.partnerId),
              eq(relicInventory.cardId, input.requestSerial),
            ),
          )
          .for("update");
        if (!request) throw new RelicError("INVALID_TARGET");
        if (request.inventory.lockedTradeId != null) throw new RelicError("CARD_LOCKED");
      }

      if (coins > 0) {
        const debited = await tx
          .update(economyAccounts)
          .set({
            balance: sql`${economyAccounts.balance} - ${coins}`,
            totalSpent: sql`${economyAccounts.totalSpent} + ${coins}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(economyAccounts.guildId, input.guild.id),
              eq(economyAccounts.userId, input.proposerId),
              gte(economyAccounts.balance, coins),
            ),
          )
          .returning({ userId: economyAccounts.userId });
        if (!debited.length) throw new RelicError("INSUFFICIENT_FUNDS");
        await tx.insert(economyTransactions).values({
          guildId: input.guild.id,
          fromUserId: input.proposerId,
          amount: coins,
          kind: "relic_trade_escrow",
          reason: `${input.offerSerial} for ${input.requestSerial ?? "gift"}`,
        });
      }

      const [row] = await tx
        .insert(relicTrades)
        .values({
          guildId: input.guild.id,
          proposerId: input.proposerId,
          partnerId: input.partnerId,
          offerCardId: input.offerSerial,
          requestCardId: input.requestSerial,
          coins,
          channelId: input.channel.id,
          expiresAt: new Date(Date.now() + RELIC_TRADE_TTL_MS),
        })
        .returning();
      if (!row) throw new Error("Failed to create relic trade");
      const locked = await tx
        .update(relicInventory)
        .set({ lockedTradeId: row.id })
        .where(
          and(
            eq(relicInventory.cardId, input.offerSerial),
            eq(relicInventory.userId, input.proposerId),
            eq(relicInventory.guildId, input.guild.id),
          ),
        )
        .returning({ id: relicInventory.id });
      if (!locked.length) throw new RelicError("NOT_OWNER");
      if (input.requestSerial != null) {
        const lockedRequest = await tx
          .update(relicInventory)
          .set({ lockedTradeId: row.id })
          .where(
            and(
              eq(relicInventory.cardId, input.requestSerial),
              eq(relicInventory.userId, input.partnerId),
              eq(relicInventory.guildId, input.guild.id),
            ),
          )
          .returning({ id: relicInventory.id });
        if (!lockedRequest.length) throw new RelicError("INVALID_TARGET");
      }
      return row;
    });

    if (coins > 0) await this.economy.invalidateBalance(input.guild.id, input.proposerId).catch(() => undefined);
    try {
      const payload = await this.tradePayload(input.guild.id, trade);
      const message = await input.channel.send(styleMessage({
        components: payload.components,
        files: payload.files,
        flags: payload.flags,
        allowedMentions: { users: [input.partnerId] },
      }));
      await this.db
        .update(relicTrades)
        .set({ messageId: message.id })
        .where(eq(relicTrades.id, trade.id));
      return { ...trade, messageId: message.id };
    } catch (error) {
      await this.closeTrade(trade.id, "cancelled", input.proposerId).catch(() => undefined);
      throw error;
    }
  }

  async acceptTrade(guildId: string, tradeId: number, actorId: string): Promise<RelicTradeRow> {
    const [preflight] = await this.db
      .select({ status: relicTrades.status, expiresAt: relicTrades.expiresAt })
      .from(relicTrades)
      .where(and(eq(relicTrades.guildId, guildId), eq(relicTrades.id, tradeId)))
      .limit(1);
    if (!preflight) throw new RelicError("TRADE_NOT_FOUND");
    if (preflight.status === "pending" && preflight.expiresAt.getTime() <= Date.now()) {
      await this.closeTrade(tradeId, "expired", null, guildId);
      throw new RelicError("TRADE_EXPIRED");
    }
    const accepted = await this.db.transaction(async (tx) => {
      const [trade] = await tx
        .select()
        .from(relicTrades)
        .where(and(eq(relicTrades.guildId, guildId), eq(relicTrades.id, tradeId)))
        .for("update");
      if (!trade) throw new RelicError("TRADE_NOT_FOUND");
      if (trade.partnerId !== actorId) throw new RelicError("NOT_PARTICIPANT");
      if (trade.status !== "pending") throw new RelicError("TRADE_NOT_PENDING");
      if (trade.expiresAt.getTime() <= Date.now()) throw new RelicError("TRADE_EXPIRED");
      const now = new Date();

      const [offer] = await tx
        .select()
        .from(relicInventory)
        .where(
          and(
            eq(relicInventory.cardId, trade.offerCardId),
            eq(relicInventory.userId, trade.proposerId),
            eq(relicInventory.guildId, guildId),
          ),
        )
        .for("update");
      if (!offer || offer.lockedTradeId !== trade.id) throw new RelicError("CARD_LOCKED");

      let request: RelicInventoryRow | null = null;
      if (trade.requestCardId != null) {
        const [row] = await tx
          .select()
          .from(relicInventory)
          .where(
            and(
              eq(relicInventory.cardId, trade.requestCardId),
              eq(relicInventory.userId, trade.partnerId),
              eq(relicInventory.guildId, guildId),
            ),
          )
          .for("update");
        if (!row) throw new RelicError("NOT_OWNER");
        if (row.lockedTradeId != null && row.lockedTradeId !== trade.id) throw new RelicError("CARD_LOCKED");
        request = row;
      }

      await tx
        .update(relicInventory)
        .set({ userId: trade.partnerId, lockedTradeId: null, acquiredVia: "trade" })
        .where(eq(relicInventory.id, offer.id));
      await tx
        .update(relicCards)
        .set({ ownerId: trade.partnerId })
        .where(eq(relicCards.id, trade.offerCardId));
      if (request) {
        await tx
          .update(relicInventory)
          .set({ userId: trade.proposerId, lockedTradeId: null, acquiredVia: "trade" })
          .where(eq(relicInventory.id, request.id));
        await tx
          .update(relicCards)
          .set({ ownerId: trade.proposerId })
          .where(eq(relicCards.id, trade.requestCardId!));
      }

      await tx
        .update(relicProfiles)
        .set({ featuredCardId: null, updatedAt: now })
        .where(
          and(
            eq(relicProfiles.guildId, guildId),
            eq(relicProfiles.userId, trade.proposerId),
            eq(relicProfiles.featuredCardId, trade.offerCardId),
          ),
        );
      if (trade.requestCardId != null) {
        await tx
          .update(relicProfiles)
          .set({ featuredCardId: null, updatedAt: now })
          .where(
            and(
              eq(relicProfiles.guildId, guildId),
              eq(relicProfiles.userId, trade.partnerId),
              eq(relicProfiles.featuredCardId, trade.requestCardId),
            ),
          );
      }

      if (trade.coins > 0) {
        await tx
          .update(economyAccounts)
          .set({
            balance: sql`${economyAccounts.balance} + ${trade.coins}`,
            updatedAt: now,
          })
          .where(and(eq(economyAccounts.guildId, guildId), eq(economyAccounts.userId, trade.partnerId)));
        await tx.insert(economyTransactions).values({
          guildId,
          toUserId: trade.partnerId,
          amount: trade.coins,
          kind: "relic_trade_payout",
          reason: `trade ${trade.id}`,
        });
      }

      const [row] = await tx
        .update(relicTrades)
        .set({ status: "accepted", resolvedAt: now })
        .where(eq(relicTrades.id, trade.id))
        .returning();
      if (!row) throw new Error("Failed to accept relic trade");
      return row;
    });

    await this.economy.invalidateBalance(guildId, accepted.proposerId).catch(() => undefined);
    await this.economy.invalidateBalance(guildId, accepted.partnerId).catch(() => undefined);
    await this.refreshTradeMessage(accepted.id).catch(() => undefined);
    return accepted;
  }

  async declineTrade(guildId: string, tradeId: number, actorId: string): Promise<RelicTradeRow | null> {
    return this.closeTrade(tradeId, "declined", actorId, guildId);
  }

  private async closeTrade(
    tradeId: number,
    status: "declined" | "expired" | "cancelled",
    actorId: string | null,
    guildId?: string,
  ): Promise<RelicTradeRow | null> {
    const closed = await this.db.transaction(async (tx) => {
      const [trade] = await tx
        .select()
        .from(relicTrades)
        .where(eq(relicTrades.id, tradeId))
        .for("update");
      if (!trade) throw new RelicError("TRADE_NOT_FOUND");
      if (guildId && trade.guildId !== guildId) throw new RelicError("TRADE_NOT_FOUND");
      if (trade.status !== "pending") return null;
      if (actorId && actorId !== trade.proposerId && actorId !== trade.partnerId) {
        throw new RelicError("NOT_PARTICIPANT");
      }
      const now = new Date();
      if (trade.coins > 0) {
        const refunded = await tx
          .update(economyAccounts)
          .set({ balance: sql`${economyAccounts.balance} + ${trade.coins}`, updatedAt: now })
          .where(
            and(
              eq(economyAccounts.guildId, trade.guildId),
              eq(economyAccounts.userId, trade.proposerId),
            ),
          )
          .returning({ userId: economyAccounts.userId });
        if (!refunded.length) throw new Error("Missing account for trade refund");
        await tx.insert(economyTransactions).values({
          guildId: trade.guildId,
          toUserId: trade.proposerId,
          amount: trade.coins,
          kind: "relic_trade_refund",
          reason: `trade ${trade.id} ${status}`,
        });
      }
      await tx
        .update(relicInventory)
        .set({ lockedTradeId: null })
        .where(eq(relicInventory.lockedTradeId, trade.id));
      const [row] = await tx
        .update(relicTrades)
        .set({ status, resolvedAt: now })
        .where(eq(relicTrades.id, trade.id))
        .returning();
      return row ?? null;
    });
    if (closed) {
      if (closed.coins > 0) {
        await this.economy.invalidateBalance(closed.guildId, closed.proposerId).catch(() => undefined);
      }
      await this.refreshTradeMessage(closed.id).catch(() => undefined);
    }
    return closed;
  }

  private async expireDueTrades(guildId: string): Promise<void> {
    const due = await this.db
      .select({ id: relicTrades.id })
      .from(relicTrades)
      .where(
        and(
          eq(relicTrades.guildId, guildId),
          eq(relicTrades.status, "pending"),
          lte(relicTrades.expiresAt, new Date()),
        ),
      )
      .limit(20);
    for (const row of due) {
      await this.closeTrade(row.id, "expired", null, guildId).catch((error) =>
        this.logger.warn({ err: error, tradeId: row.id }, "failed to expire relic trade"),
      );
    }
  }

  private async tradePayload(guildId: string, trade: RelicTradeRow): Promise<ReplyPayload> {
    const [offerCard] = await this.db
      .select()
      .from(relicCards)
      .where(eq(relicCards.id, trade.offerCardId))
      .limit(1);
    const requestCard = trade.requestCardId
      ? (await this.db.select().from(relicCards).where(eq(relicCards.id, trade.requestCardId)).limit(1))[0] ?? null
      : null;
    if (!offerCard) throw new RelicError("CARD_NOT_FOUND");
    return buildTradePayload({
      trade,
      offerCard,
      requestCard,
      proposerName: await this.displayName(guildId, trade.proposerId),
      partnerName: await this.displayName(guildId, trade.partnerId),
    });
  }

  private async refreshTradeMessage(tradeId: number): Promise<void> {
    const [trade] = await this.db.select().from(relicTrades).where(eq(relicTrades.id, tradeId)).limit(1);
    if (!trade || !trade.messageId || !trade.channelId) return;
    const guild = await this.client.guilds.fetch(trade.guildId).catch(() => null);
    if (!guild) return;
    const channel = await this.resolveChannel(guild, trade.channelId);
    if (!channel) return;
    const message = await channel.messages.fetch(trade.messageId).catch(() => null);
    if (!message) return;
    const payload = await this.tradePayload(trade.guildId, trade);
    await message
      .edit(styleMessage({ components: payload.components, files: payload.files, flags: payload.flags, attachments: [] }))
      .catch(() => undefined);
  }

  async grantCard(
    guildId: string,
    userId: string,
    rarity: RelicRarity | undefined,
    actorId: string,
  ): Promise<RelicCardRow> {
    const cardRow = await this.mintCard(guildId, rarity, new Date());
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(relicCards)
        .set({
          ownerId: userId,
          mintedAt: now,
          mintedPrice: 0,
          acquiredVia: "grant",
        })
        .where(eq(relicCards.id, cardRow.id));
      await tx
        .insert(relicInventory)
        .values({
          guildId,
          userId,
          cardId: cardRow.id,
          acquiredVia: "grant",
          acquiredPrice: 0,
          lastYieldAt: now,
        })
        .onConflictDoNothing();
      await tx
        .update(relicProfiles)
        .set({ updatedAt: now })
        .where(and(eq(relicProfiles.guildId, guildId), eq(relicProfiles.userId, userId)));
    });
    await this.audit.log({
      guildId,
      actorId,
      source: "discord",
      action: "relics.card.grant",
      targetType: "user",
      targetId: userId,
      after: { cardId: cardRow.id, rarity: cardRow.rarity },
    });
    this.artCache.delete(cardRow.id);
    await this.cardArt(await this.getCard(guildId, cardRow.id)).catch(() => undefined);
    return { ...cardRow, ownerId: userId, mintedAt: now, mintedPrice: 0, acquiredVia: "grant" };
  }

  private async displayName(guildId: string, userId: string): Promise<string> {
    const guild = this.guilds.get(guildId) ?? (await this.client.guilds.fetch(guildId).catch(() => null));
    if (!guild) return `<@${userId}>`;
    const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
    return member?.displayName ?? `<@${userId}>`;
  }

  getAuctionDefaults(settings: RelicSettingsRow): {
    startHourIst: number;
    durationMinutes: number;
    startingBid: number;
    minIncrement: number;
  } {
    return {
      startHourIst: settings.startHourIst,
      durationMinutes: settings.durationMinutes,
      startingBid: settings.startingBid,
      minIncrement: settings.minIncrement,
    };
  }

  /** Exposed for the slash command's "bid" form and status output. */
  async auctionStatus(guildId: string): Promise<{
    auction: RelicAuctionRow | null;
    nextBid: number | null;
    card: RelicCardRow | null;
    settings: RelicSettingsRow;
  }> {
    const settings = await this.getSettings(guildId);
    const auction = await this.getLiveAuction(guildId);
    if (!auction) return { auction: null, nextBid: null, card: null, settings };
    const [cardRow] = await this.db.select().from(relicCards).where(eq(relicCards.id, auction.cardId)).limit(1);
    return {
      auction,
      card: cardRow ?? null,
      nextBid: nextRelicBid(
        auction.highestBid > 0 ? auction.highestBid : null,
        auction.startingBid,
        auction.minIncrement,
      ),
      settings,
    };
  }

  /** Exposed for the command's plain text "my bid" view. */
  async standing(guildId: string, userId: string, auctionId: number): Promise<{
    leading: boolean;
    amount: number | null;
    nextBid: number;
    balance: number;
  }> {
    const auction = await this.requireLiveAuction(guildId, auctionId);
    const balance = await this.economy.getBalance(guildId, userId);
    const [lastBid] = await this.db
      .select()
      .from(relicBids)
      .where(and(eq(relicBids.auctionId, auctionId), eq(relicBids.userId, userId)))
      .orderBy(desc(relicBids.id))
      .limit(1);
    return {
      leading: auction.highestBidderId === userId,
      amount: lastBid?.amount ?? null,
      nextBid: nextRelicBid(
        auction.highestBid > 0 ? auction.highestBid : null,
        auction.startingBid,
        auction.minIncrement,
      ),
      balance: balance.balance,
    };
  }

  /** Exposed for `/relics rules` and the pinned help card. */
  rulesPayload(): ReplyPayload {
    return buildRulesPayload();
  }

  /** Best collection rarity, used by the command's config/status card. */
  async guildSummary(guildId: string): Promise<{ cards: number; mythic: number; legendary: number }> {
    const [row] = await this.db
      .select({
        cards: sql<number>`count(*)::int`,
        mythic: sql<number>`count(*) filter (where ${relicCards.rarity} = 'mythic')::int`,
        legendary: sql<number>`count(*) filter (where ${relicCards.rarity} = 'legendary')::int`,
      })
      .from(relicCards)
      .where(and(eq(relicCards.guildId, guildId), isNotNull(relicCards.ownerId)));
    return {
      cards: Number(row?.cards ?? 0),
      mythic: Number(row?.mythic ?? 0),
      legendary: Number(row?.legendary ?? 0),
    };
  }
}
