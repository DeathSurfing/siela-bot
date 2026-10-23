import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import {
  RELIC_RARITIES,
  RELIC_RARITY_ORDER,
  RELIC_VARIANTS,
  isRelicGenesis,
  nextRelicBid,
  relicSerialLabel,
  relicYieldPerDay,
  type RelicRarity,
} from "@siela/shared";
import type {
  RelicAuctionRow,
  RelicCardRow,
  RelicTradeRow,
} from "@siela/db";
import type { ReplyPayload } from "../../framework/types.js";
import { progressBar } from "../ui.js";

export const RELIC_ACCENT = 0x8b5cf6;
export const RELIC_ART_NAME = (serial: number): string => `relic-${serial}.png`;

export function asRelicRarity(value: string): RelicRarity {
  return (RELIC_RARITY_ORDER as string[]).includes(value) ? (value as RelicRarity) : "common";
}

export function formatSc(value: number): string {
  return `${Math.max(0, Math.round(value)).toLocaleString()} SC`;
}

export function relicVariantName(key: string): string {
  return RELIC_VARIANTS.find((variant) => variant.key === key)?.name ?? "Standard";
}

function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(content);
}

function separator(): SeparatorBuilder {
  return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function row(...components: MessageActionRowComponentBuilder[]): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...components);
}

function gallery(art: Buffer, serial: number): MediaGalleryBuilder {
  return new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder()
      .setURL(`attachment://${RELIC_ART_NAME(serial)}`)
      .setDescription(`Relic ${relicSerialLabel(serial)}`),
  );
}

function baseContainer(accent = RELIC_ACCENT): ContainerBuilder {
  return new ContainerBuilder().setAccentColor(accent);
}

function finish(
  container: ContainerBuilder,
  art: Buffer | null,
  serial: number,
  rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [],
): ReplyPayload {
  const components = [container];
  const files = art ? [new AttachmentBuilder(art, { name: RELIC_ART_NAME(serial) })] : [];
  return {
    components,
    files,
    flags: MessageFlags.IsComponentsV2,
  };
}

export function buildAuctionPayload(input: {
  auction: RelicAuctionRow;
  card: RelicCardRow;
  art: Buffer;
}): ReplyPayload {
  const { auction, card, art } = input;
  const rarity = RELIC_RARITIES[asRelicRarity(card.rarity)];
  const variant = relicVariantName(card.variantKey);
  const serial = relicSerialLabel(card.id);
  const current = auction.highestBid > 0 ? auction.highestBid : null;
  const next = nextRelicBid(current, auction.startingBid, auction.minIncrement);
  const live = auction.status === "live" && auction.endsAt.getTime() > Date.now();
  const token = Math.floor(auction.endsAt.getTime() / 1000);

  const container = baseContainer(Number.parseInt(rarity.color.replace("#", ""), 16));
  container.addTextDisplayComponents(text(`## 🔨 Daily Relic · ${serial}`));
  container.addTextDisplayComponents(text(`-# ${rarity.badge} · ${variant}${card.isGenesis ? " · ✦ GENESIS" : ""}`));
  container.addMediaGalleryComponents(gallery(art, card.id));
  container.addTextDisplayComponents(
    text(
      [
        `### ${card.emoji} ${card.name}`,
        `> ${card.lore}`,
        "",
        `**POWER** ${card.power} · **CHAOS** ${card.chaos} · **LUCK** ${card.luck} · **AURA** ${card.aura} · **RATING** ${card.rating}`,
        `**Yield** · ${formatSc(relicYieldPerDay(asRelicRarity(card.rarity), card.id))}/day${card.isGenesis ? " · Genesis ×2" : ""}`,
        "",
        `**Current bid** · ${
          auction.highestBidderId
            ? `${formatSc(auction.highestBid)} — <@${auction.highestBidderId}>`
            : `No bids yet · starts at ${formatSc(auction.startingBid)}`
        }`,
        `**Next bid** · ${formatSc(next)}`,
        `**Ends** · <t:${token}:R> (<t:${token}:t>)`,
        `-# ${auction.bidCount} bid${auction.bidCount === 1 ? "" : "s"} · min increment ${formatSc(auction.minIncrement)} · react 💰 to bid ${formatSc(next)}`,
      ].join("\n"),
    ),
  );
  container.addSeparatorComponents(separator());

  if (live) {
    container.addActionRowComponents(
      row(
        new ButtonBuilder()
          .setCustomId(`relics:bid:${auction.id}`)
          .setLabel(`Bid ${formatSc(next)}`)
          .setEmoji("💰")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`relics:bidmodal:${auction.id}`)
          .setLabel("Custom bid")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`relics:mine:${auction.id}`)
          .setLabel("My standing")
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  } else {
    container.addActionRowComponents(
      row(
        new ButtonBuilder()
          .setCustomId(`relics:card:${card.id}`)
          .setLabel("View relic")
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  }

  return finish(container, art, card.id);
}

export function buildAuctionResultPayload(input: {
  auction: RelicAuctionRow;
  card: RelicCardRow;
  art: Buffer;
  winnerId: string | null;
}): ReplyPayload {  const { auction, card, art, winnerId } = input;
  const rarity = RELIC_RARITIES[asRelicRarity(card.rarity)];
  const variant = relicVariantName(card.variantKey);
  const container = baseContainer(Number.parseInt(rarity.color.replace("#", ""), 16));
  container.addTextDisplayComponents(text(winnerId ? "## 🏆 Relic claimed" : "## 🗄️ Relic returned to the vault"));
  container.addTextDisplayComponents(
    text(winnerId ? `-# ${relicSerialLabel(card.id)} · ${rarity.label} · ${variant}` : `-# ${relicSerialLabel(card.id)} · no bids`),
  );
  container.addMediaGalleryComponents(gallery(art, card.id));
  container.addTextDisplayComponents(
    text(
      winnerId
        ? [
            `**${card.emoji} ${card.name}**`,
            `<@${winnerId}> won this one-of-one relic for **${formatSc(auction.winningBid ?? 0)}** after ${auction.bidCount} bid${auction.bidCount === 1 ? "" : "s"}.`,
            "",
            `-# It now lives in their vault and earns ${formatSc(relicYieldPerDay(asRelicRarity(card.rarity), card.id))} per day.`,
          ].join("\n")
        : [
            `**${card.emoji} ${card.name}**`,
            `Nobody placed a bid, so ${relicSerialLabel(card.id)} stays unminted in the vault forever.`,
            "",
            "-# The next relic drops tomorrow at 4:00 PM IST.",
          ].join("\n"),
    ),
  );
  container.addActionRowComponents(
    row(
      new ButtonBuilder()
        .setCustomId(`relics:card:${card.id}`)
        .setLabel("Inspect relic")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("relics:auction")
        .setLabel("Next auction")
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return finish(container, art, card.id);
}

export function buildCancelledAuctionPayload(
  auction: RelicAuctionRow,
  card: RelicCardRow,
): ReplyPayload {
  const rarity = RELIC_RARITIES[asRelicRarity(card.rarity)];
  const container = baseContainer(0x64748b);
  container.addTextDisplayComponents(text("## ⚠️ Relic auction cancelled"));
  container.addTextDisplayComponents(
    text(
      [
        `**${card.emoji} ${card.name}** · ${relicSerialLabel(card.id)} · ${rarity.label}`,
        "",
        "Every escrowed bid has been refunded. The relic returned to the vault.",
        `-# Auction ${auction.id} cancelled.`,
      ].join("\n"),
    ),
  );
  return finish(container, null, 0);
}

export interface InventoryStats {
  cards: number;
  rating: number;
  yieldPerDay: number;
  auctionWins: number;
  rarityCounts: Record<RelicRarity, number>;
}

export function buildInventoryPayload(input: {
  userId: string;
  displayName: string;
  entries: RelicCardRow[];
  total: number;
  page: number;
  pages: number;
  stats: InventoryStats;
  featured: RelicCardRow | null;
  featuredArt: Buffer | null;
}): ReplyPayload {
  const { entries, total, page, pages, stats, featured, featuredArt } = input;
  const container = baseContainer();
  container.addTextDisplayComponents(text(`## 🗃️ ${input.displayName}'s Relic Vault`));
  container.addTextDisplayComponents(
    text(
      `-# ${total} relic${total === 1 ? "" : "s"} · ${stats.rating.toLocaleString()} total rating · ${formatSc(stats.yieldPerDay)}/day yield · ${stats.auctionWins} auction win${stats.auctionWins === 1 ? "" : "s"}`,
    ),
  );
  if (featured && featuredArt) {
    container.addMediaGalleryComponents(gallery(featuredArt, featured.id));
    container.addTextDisplayComponents(
      text(`-# Featured · ${featured.emoji} **${featured.name}** ${relicSerialLabel(featured.id)}`),
    );
  }
  container.addSeparatorComponents(separator());

  if (!entries.length) {
    container.addTextDisplayComponents(
      text(
        [
          "Your vault is empty.",
          "",
          "Win a daily relic auction, trade with another collector, or ask an admin for a grant.",
          "-# Auctions run every day from 4:00 PM to 5:00 PM IST.",
        ].join("\n"),
      ),
    );
  } else {
    const lines = entries.map((card) => {
      const rarity = RELIC_RARITIES[asRelicRarity(card.rarity)];
      return `${rarity.emoji} **${relicSerialLabel(card.id)}** · ${card.emoji} ${card.name} · ${relicVariantName(card.variantKey)} · ${card.rating} rating`;
    });
    const rarities = RELIC_RARITY_ORDER.filter((rarity) => stats.rarityCounts[rarity] > 0)
      .map((rarity) => `${RELIC_RARITIES[rarity].emoji} ${stats.rarityCounts[rarity]}`)
      .join(" · ");
    container.addTextDisplayComponents(text(lines.join("\n")));
    if (rarities) container.addTextDisplayComponents(text(`-# ${rarities}`));
  }

  const nav: ButtonBuilder[] = [];
  if (pages > 1) {
    nav.push(
      new ButtonBuilder()
        .setCustomId(`relics:inv:${input.userId}:${Math.max(0, page - 1)}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(`relics:inv:${input.userId}:${Math.min(pages - 1, page + 1)}`)
        .setLabel(`Page ${page + 1}/${pages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`relics:inv:${input.userId}:${Math.min(pages - 1, page + 1)}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pages - 1),
    );
  }
  container.addActionRowComponents(
    row(
      ...nav,
      new ButtonBuilder()
        .setCustomId(`relics:profile:${input.userId}`)
        .setLabel("Profile")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("relics:auction")
        .setLabel("Auction")
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return finish(container, featuredArt, featured?.id ?? 0);
}

export function buildCardPayload(input: {
  card: RelicCardRow;
  art: Buffer;
  ownerId: string | null;
  showShowcase: boolean;
}): ReplyPayload {
  const { card, art, ownerId } = input;
  const rarity = RELIC_RARITIES[asRelicRarity(card.rarity)];
  const container = baseContainer(Number.parseInt(rarity.color.replace("#", ""), 16));
  container.addTextDisplayComponents(text(`## ${card.emoji} ${card.name}`));
  container.addTextDisplayComponents(
    text(
      `-# ${rarity.badge} · ${relicVariantName(card.variantKey)} · ${relicSerialLabel(card.id)} · 1 of 1${card.isGenesis ? " · ✦ GENESIS" : ""}`,
    ),
  );
  container.addMediaGalleryComponents(gallery(art, card.id));
  container.addTextDisplayComponents(
    text(
      [
        `> ${card.lore}`,
        "",
        `**POWER** ${card.power}/99 ${progressBar(card.power, 99, 10)}`,
        `**CHAOS** ${card.chaos}/99 ${progressBar(card.chaos, 99, 10)}`,
        `**LUCK** ${card.luck}/99 ${progressBar(card.luck, 99, 10)}`,
        `**AURA** ${card.aura}/99 ${progressBar(card.aura, 99, 10)}`,
        `**RATING** · ${card.rating}`,
        `**YIELD** · ${formatSc(relicYieldPerDay(asRelicRarity(card.rarity), card.id))}/day`,
        "",
        `**Owner** · ${ownerId ? `<@${ownerId}>` : "Unminted · still in the vault"}`,
        `**Minted** · ${card.mintedAt ? `<t:${Math.floor(card.mintedAt.getTime() / 1000)}:D>` : "never"}${
          card.mintedPrice ? ` for ${formatSc(card.mintedPrice)}` : ""
        }`,
        card.acquiredVia ? `**Acquired via** · ${card.acquiredVia}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  );
  const buttons: ButtonBuilder[] = [];
  if (input.showShowcase) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`relics:showcase:${card.id}`)
        .setLabel("Feature this relic")
        .setStyle(ButtonStyle.Primary),
    );
  }
  buttons.push(
    new ButtonBuilder()
      .setCustomId(ownerId ? `relics:inv:${ownerId}:0` : "relics:auction")
      .setLabel(ownerId ? "Open vault" : "View auction")
      .setStyle(ButtonStyle.Secondary),
  );
  container.addActionRowComponents(row(...buttons));
  return finish(container, art, card.id);
}

export interface RelicProfileStats extends InventoryStats {
  yieldClaimed: number;
  joinedAt: Date | null;
  topRarity: RelicRarity | null;
}

export function buildProfilePayload(input: {
  userId: string;
  displayName: string;
  stats: RelicProfileStats;
  featured: RelicCardRow | null;
  featuredArt: Buffer | null;
}): ReplyPayload {
  const { stats, featured, featuredArt } = input;
  const container = baseContainer();
  container.addTextDisplayComponents(text(`## 🎴 ${input.displayName}'s collector profile`));
  container.addTextDisplayComponents(
    text(`-# ${stats.cards} relic${stats.cards === 1 ? "" : "s"} · joined ${stats.joinedAt ? `<t:${Math.floor(stats.joinedAt.getTime() / 1000)}:D>` : "recently"}`),
  );
  if (featured && featuredArt) {
    container.addMediaGalleryComponents(gallery(featuredArt, featured.id));
    container.addTextDisplayComponents(
      text(
        `-# Featured · ${featured.emoji} **${featured.name}** · ${RELIC_RARITIES[asRelicRarity(featured.rarity)].label} · ${relicSerialLabel(featured.id)}`,
      ),
    );
  }
  container.addSeparatorComponents(separator());
  const rarityLine = RELIC_RARITY_ORDER.filter((rarity) => stats.rarityCounts[rarity] > 0)
    .map((rarity) => `${RELIC_RARITIES[rarity].emoji} ${stats.rarityCounts[rarity]}`)
    .join(" · ");
  const badges: string[] = [];
  if (stats.rarityCounts.mythic > 0) badges.push("🔴 Mythic holder");
  if (stats.rarityCounts.legendary > 0) badges.push("🟡 Legendary holder");
  if (stats.cards >= 10) badges.push("🗃️ Vaultkeeper");
  if (stats.auctionWins >= 5) badges.push("🔨 Auction regular");
  container.addTextDisplayComponents(
    text(
      [
        `**Collection rating** · ${stats.rating.toLocaleString()}`,
        `**Vault yield** · ${formatSc(stats.yieldPerDay)}/day`,
        `**Yield claimed** · ${formatSc(stats.yieldClaimed)}`,
        `**Auction wins** · ${stats.auctionWins}`,
        `**Top rarity** · ${stats.topRarity ? `${RELIC_RARITIES[stats.topRarity].emoji} ${RELIC_RARITIES[stats.topRarity].label}` : "none"}`,
        rarityLine ? `**Rarities** · ${rarityLine}` : "",
        badges.length ? `**Badges** · ${badges.join(" · ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  );
  container.addActionRowComponents(
    row(
      new ButtonBuilder()
        .setCustomId(`relics:inv:${input.userId}:0`)
        .setLabel("View vault")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("relics:top")
        .setLabel("Leaderboard")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("relics:rules")
        .setLabel("How it works")
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return finish(container, featuredArt, featured?.id ?? 0);
}

export function buildTradePayload(input: {
  trade: RelicTradeRow;
  offerCard: RelicCardRow;
  requestCard: RelicCardRow | null;
  proposerName: string;
  partnerName: string;
}): ReplyPayload {
  const { trade, offerCard, requestCard } = input;
  const status = trade.status;
  const container = baseContainer(status === "accepted" ? 0x22c55e : status === "pending" ? RELIC_ACCENT : 0x64748b);
  container.addTextDisplayComponents(
    text(
      status === "accepted"
        ? "## ✅ Relic trade accepted"
        : status === "pending"
          ? "## 🔁 Relic trade offer"
          : "## ⌛ Relic trade closed",
    ),
  );
  container.addTextDisplayComponents(
    text(
      [
        `**From** · ${input.proposerName}`,
        `**To** · ${input.partnerName}`,
        "",
        `**${input.proposerName} offers**`,
        `> ${offerCard.emoji} ${offerCard.name} · ${relicSerialLabel(offerCard.id)} · ${RELIC_RARITIES[asRelicRarity(offerCard.rarity)].label}`,
        trade.coins > 0 ? `> + **${formatSc(trade.coins)}**` : "",
        "",
        requestCard
          ? `**${input.partnerName} gives**\n> ${requestCard.emoji} ${requestCard.name} · ${relicSerialLabel(requestCard.id)} · ${RELIC_RARITIES[asRelicRarity(requestCard.rarity)].label}`
          : `**In return** · nothing, this is a gift`,
        "",
        status === "pending"
          ? `-# Offer expires <t:${Math.floor(trade.expiresAt.getTime() / 1000)}:R>. Only ${input.partnerName} can accept.`
          : `-# Trade ${status}${trade.resolvedAt ? ` <t:${Math.floor(trade.resolvedAt.getTime() / 1000)}:R>` : ""}.`,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  );
  if (status === "pending") {
    container.addActionRowComponents(
      row(
        new ButtonBuilder()
          .setCustomId(`relics:trade:accept:${trade.id}`)
          .setLabel("Accept trade")
          .setEmoji("✅")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`relics:trade:decline:${trade.id}`)
          .setLabel("Decline")
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  }
  return finish(container, null, 0);
}

export function buildLeaderboardPayload(input: {
  entries: Array<{ userId: string; cards: number; rating: number; wins: number }>;
}): ReplyPayload {
  const container = baseContainer();
  container.addTextDisplayComponents(text("## 🏆 Relic leaderboard"));
  container.addTextDisplayComponents(text("-# Ranked by total collection rating."));
  container.addSeparatorComponents(separator());
  if (!input.entries.length) {
    container.addTextDisplayComponents(text("No relics have been minted yet. The first auction is waiting for a champion."));
  } else {
    const lines = input.entries.map((entry, index) => {
      const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`;
      return `${medal} <@${entry.userId}> · **${entry.rating.toLocaleString()}** rating · ${entry.cards} relic${entry.cards === 1 ? "" : "s"} · ${entry.wins} auction win${entry.wins === 1 ? "" : "s"}`;
    });
    container.addTextDisplayComponents(text(lines.join("\n")));
  }
  container.addActionRowComponents(
    row(
      new ButtonBuilder()
        .setCustomId("relics:auction")
        .setLabel("Live auction")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("relics:rules")
        .setLabel("How it works")
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return finish(container, null, 0);
}

export function buildRulesPayload(): ReplyPayload {
  const container = baseContainer();
  container.addTextDisplayComponents(text("## 📖 How Siela Relics works"));
  container.addTextDisplayComponents(
    text(
      [
        "**One card. One owner. One hour.**",
        "",
        "Every day at **4:00 PM IST**, one procedurally generated, one-of-one relic is revealed in the auction channel. Bidding closes at **5:00 PM IST**. Highest bid wins and the card is permanently minted to that collector.",
        "",
        "**Bidding**",
        "• Bids are paid in Siela Coins (SC) and held in escrow the moment you bid.",
        "• Get outbid and your coins are refunded automatically.",
        "• React with 💰 or use **Bid** / **Custom bid**. If you cannot afford a bid, the bot tells you privately.",
        "• Minimum raise is the card's increment. Bids are final.",
        "",
        "**Rarity**",
        "• Common → Uncommon → Rare → Epic → Legendary → Mythic.",
        "• Saturday and Sunday use a weekend table with much better odds at Rare and above.",
        "• Serial **#0001–#0010** are Genesis relics: double yield and a permanent badge.",
        "",
        "**Vault yield**",
        "• Every relic earns passive SC each day while you hold it.",
        "• Use `/relics collect` to claim. Accrual caps at 30 days.",
        "",
        "**Trading**",
        "• `/relics trade @user <your card> [their card] [coins]` creates a 10-minute offer.",
        "• The offered card and coins are locked until the trade resolves.",
        "",
        "**Fairness**",
        "• Only one active bidder at a time; no shill refunds, no bid sniping after close.",
        "• Auctions settle from the database, so a bot restart never loses a result.",
      ].join("\n"),
    ),
  );
  container.addActionRowComponents(
    row(
      new ButtonBuilder()
        .setCustomId("relics:auction")
        .setLabel("Live auction")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("relics:top")
        .setLabel("Leaderboard")
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return finish(container, null, 0);
}
