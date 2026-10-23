import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type GuildMember,
  type GuildTextBasedChannel,
} from "discord.js";
import {
  RELIC_RARITIES,
  RELIC_RARITY_ORDER,
  nextRelicDropAt,
  relicDropWindow,
  relicSerialLabel,
  type RelicRarity,
} from "@siela/shared";
import type { RelicSettingsRow } from "@siela/db";
import type { Command, CommandContext } from "../../framework/types.js";
import { isAdmin } from "../../framework/permissions.js";
import { ForbiddenError, UserError } from "../../lib/errors.js";
import { card, success } from "../../features/ui.js";
import {
  RelicError,
  relicErrorMessage,
} from "../../features/relics/service.js";
import { formatSc } from "../../features/relics/ui.js";

function parseSerial(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = raw.replace(/^#/, "").trim();
  if (!/^\d{1,10}$/.test(value)) return null;
  const serial = Number(value);
  return Number.isSafeInteger(serial) && serial > 0 ? serial : null;
}

function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function parseMention(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.replace(/^<@!?/, "").replace(/>$/, "").trim();
  return /^\d{17,20}$/.test(value) ? value : null;
}

async function resolveMember(ctx: CommandContext, raw: string | undefined): Promise<GuildMember | null> {
  const id = parseMention(raw);
  if (!id) return null;
  return ctx.guild.members.fetch(id).catch(() => null);
}

async function targetMember(ctx: CommandContext, raw: string | undefined): Promise<GuildMember> {
  if (!raw) return ctx.member;
  const member = await resolveMember(ctx, raw);
  if (!member) throw new UserError("Choose a valid member.");
  return member;
}

function requireAdmin(ctx: CommandContext): void {
  if (!isAdmin(ctx.member, ctx.services.config, ctx.guild)) {
    throw new ForbiddenError("Only admins can manage relic auctions.");
  }
}

function parsePage(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value - 1 : 0;
}

function tradeTarget(raw: string | undefined): string {
  const id = parseMention(raw);
  if (!id) throw new UserError("Usage: `/relics trade user:@member offer:<serial> [request:<serial>] [coins:<amount>]`.");
  return id;
}

function initialPageFromArgs(args: string[]): { target: string | null; page: number } {
  const first = args[1];
  if (!first) return { target: null, page: 0 };
  const id = parseMention(first);
  if (id) return { target: id, page: parsePage(args[2]) };
  return { target: null, page: parsePage(first) };
}

function auctionUnavailable(settings: RelicSettingsRow) {
  const now = new Date();
  const window = relicDropWindow(now, {
    startHourIst: settings.startHourIst,
    durationMinutes: settings.durationMinutes,
    startingBid: settings.startingBid,
    minIncrement: settings.minIncrement,
  });
  const next = nextRelicDropAt(now, {
    startHourIst: settings.startHourIst,
    durationMinutes: settings.durationMinutes,
    startingBid: settings.startingBid,
    minIncrement: settings.minIncrement,
  });
  const body = [
    settings.enabled && settings.channelId
      ? `The auction channel is <#${settings.channelId}>. Auctions run daily from **${settings.startHourIst}:00** to **${String(settings.startHourIst + Math.floor(settings.durationMinutes / 60)).padStart(2, "0")}:${String(settings.durationMinutes % 60).padStart(2, "0")} IST**.`
      : settings.channelId
        ? "Relic auctions are paused. An admin can resume them with `/relics enable`."
        : "Relic auctions are not configured yet. An admin can run `/relics channel`.",
    now.getTime() >= window.start.getTime() && now.getTime() < window.end.getTime()
      ? "The auction window is open now. The drop starts on the next scheduler tick."
      : `Next window opens <t:${Math.floor(next.getTime() / 1000)}:R>.`,
  ].join("\n");
  return card({ title: "No relic is live", body });
}

export const relicsCommand: Command = {
  name: "relics",
  aliases: ["relic", "cards", "vault"],
  category: "social",
  description: "Daily one-of-one relic auctions, collectible vaults, passive yield, and trades.",
  usage: "<auction|bid|collection|card|showcase|profile|collect|top|trade|rules> ...",
  examples: [
    "relics auction",
    "relics bid 120",
    "relics collection",
    "relics card 42",
    "relics showcase 42",
    "relics trade @friend 42 77 250",
    "relics channel #relic-vault",
  ],
  cooldownMs: 2_500,
  slash: new SlashCommandBuilder()
    .setName("relics")
    .setDescription("Siela Relics: daily card auctions, collections, and trades")
    .addSubcommand((sub) => sub.setName("auction").setDescription("Show the live relic auction"))
    .addSubcommand((sub) =>
      sub
        .setName("bid")
        .setDescription("Bid on the live relic")
        .addIntegerOption((option) =>
          option.setName("amount").setDescription("Bid in Siela Coins").setRequired(false).setMinValue(1),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("collection")
        .setDescription("Browse a relic vault")
        .addUserOption((option) => option.setName("user").setDescription("Member").setRequired(false))
        .addIntegerOption((option) => option.setName("page").setDescription("Page").setRequired(false).setMinValue(1)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("card")
        .setDescription("Inspect a relic by serial")
        .addIntegerOption((option) =>
          option.setName("serial").setDescription("Serial number, e.g. 42").setRequired(true).setMinValue(1),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("showcase")
        .setDescription("Feature one of your relics on your profile")
        .addIntegerOption((option) =>
          option.setName("serial").setDescription("Serial number").setRequired(true).setMinValue(1),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("profile")
        .setDescription("Show a collector profile")
        .addUserOption((option) => option.setName("user").setDescription("Member").setRequired(false)),
    )
    .addSubcommand((sub) => sub.setName("collect").setDescription("Claim passive SC from your relics"))
    .addSubcommand((sub) => sub.setName("top").setDescription("Top relic collectors"))
    .addSubcommand((sub) =>
      sub
        .setName("trade")
        .setDescription("Offer a relic (and optionally coins) for another relic")
        .addUserOption((option) => option.setName("user").setDescription("Member to trade with").setRequired(true))
        .addIntegerOption((option) =>
          option.setName("offer").setDescription("Your relic serial").setRequired(true).setMinValue(1),
        )
        .addIntegerOption((option) =>
          option.setName("request").setDescription("Their relic serial (optional)").setRequired(false).setMinValue(1),
        )
        .addIntegerOption((option) =>
          option.setName("coins").setDescription("SC to add (optional)").setRequired(false).setMinValue(0),
        ),
    )
    .addSubcommand((sub) => sub.setName("rules").setDescription("How Siela Relics works"))
    .addSubcommand((sub) =>
      sub
        .setName("channel")
        .setDescription("Set the daily auction channel (admin)")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Text channel for auctions")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addRoleOption((option) => option.setName("ping").setDescription("Optional role to ping").setRequired(false)),
    )
    .addSubcommand((sub) => sub.setName("disable").setDescription("Pause daily auctions (admin)"))
    .addSubcommand((sub) => sub.setName("enable").setDescription("Resume daily auctions (admin)"))
    .addSubcommand((sub) => sub.setName("config").setDescription("Show relic configuration (admin)"))
    .addSubcommand((sub) =>
      sub
        .setName("start")
        .setDescription("Start a bonus auction now (admin)")
        .addIntegerOption((option) =>
          option
            .setName("minutes")
            .setDescription("Auction length in minutes (default 60)")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(180),
        ),
    )
    .addSubcommand((sub) => sub.setName("end").setDescription("End the live auction now (admin)"))
    .addSubcommand((sub) => sub.setName("cancel").setDescription("Cancel and refund the live auction (admin)"))
    .addSubcommand((sub) =>
      sub
        .setName("grant")
        .setDescription("Mint a relic directly to a member (admin)")
        .addUserOption((option) => option.setName("user").setDescription("Recipient").setRequired(true))
        .addStringOption((option) =>
          option
            .setName("rarity")
            .setDescription("Force a rarity, otherwise rolled")
            .setRequired(false)
            .addChoices(...RELIC_RARITY_ORDER.map((rarity) => ({ name: RELIC_RARITIES[rarity].label, value: rarity }))),
        ),
    ),
  async execute(ctx) {
    const relics = ctx.services.relics;
    const action = (ctx.args[0] ?? "auction").toLowerCase();

    try {
      if (action === "auction" || action === "status") {
        await ctx.defer();
        const payload = await relics.buildAuctionPayload(ctx.guild.id);
        if (payload) {
          await ctx.reply(payload);
          return;
        }
        const settings = await relics.getSettings(ctx.guild.id);
        await ctx.reply(auctionUnavailable(settings));
        return;
      }

      if (action === "bid") {
        const rawAmount = ctx.args[1];
        if (!rawAmount) {
          await ctx.defer(true);
          const status = await relics.auctionStatus(ctx.guild.id);
          if (!status.auction) throw new UserError("There is no live relic auction right now.");
          const standing = await relics.standing(ctx.guild.id, ctx.author.id, status.auction.id);
          await ctx.reply({
            content: [
              `**Balance** · ${formatSc(standing.balance)}`,
              standing.leading
                ? `You are **leading** at ${formatSc(status.auction.highestBid)}.`
                : standing.amount
                  ? `Your last bid was ${formatSc(standing.amount)} and it was outbid.`
                  : "You have not bid on this relic yet.",
              `**Next minimum** · ${formatSc(standing.nextBid)}`,
              `Use \`/relics bid amount:${standing.nextBid}\` or react with 💰 in <#${status.auction.channelId}>.`,
            ].join("\n"),
          });
          return;
        }
        const amount = parseAmount(rawAmount);
        if (amount == null) throw new UserError("Enter a whole number of Siela Coins.");
        await ctx.defer(true);
        const status = await relics.auctionStatus(ctx.guild.id);
        if (!status.auction) throw new UserError("There is no live relic auction right now.");
        const result = await relics.placeBid({
          guildId: ctx.guild.id,
          userId: ctx.author.id,
          auctionId: status.auction.id,
          amount,
        });
        await ctx.reply({
          content: `✅ Bid placed at **${formatSc(result.amount)}**. You are the highest bidder. Next minimum is ${formatSc(result.nextBid)}.`,
        });
        return;
      }

      if (action === "collection" || action === "inventory" || action === "vault") {
        await ctx.defer();
        const parsed = initialPageFromArgs(ctx.args);
        const member = parsed.target ? await targetMember(ctx, parsed.target) : ctx.member;
        if (member.user.bot) throw new UserError("Bots do not collect relics.");
        const payload = await relics.inventoryPayload(ctx.guild.id, member.id, parsed.page);
        await ctx.reply(payload);
        return;
      }

      if (action === "card" || action === "inspect") {
        const serial = parseSerial(ctx.args[1]);
        if (!serial) throw new UserError("Usage: `/relics card serial:42`.");
        await ctx.defer();
        const payload = await relics.cardPayload(ctx.guild.id, serial, ctx.author.id);
        await ctx.reply(payload);
        return;
      }

      if (action === "showcase" || action === "feature") {
        const serial = parseSerial(ctx.args[1]);
        if (!serial) throw new UserError("Usage: `/relics showcase serial:42`.");
        await ctx.defer(true);
        const result = await relics.setFeatured(ctx.guild.id, ctx.author.id, serial);
        await ctx.reply({
          content: `✅ ${result.card.emoji} **${result.card.name}** (${relicSerialLabel(result.card.id)}) is now featured on your profile.`,
        });
        return;
      }

      if (action === "profile" || action === "collector") {
        await ctx.defer();
        const member = await targetMember(ctx, ctx.args[1]);
        if (member.user.bot) throw new UserError("Bots do not collect relics.");
        const payload = await relics.profilePayload(ctx.guild.id, member.id);
        await ctx.reply(payload);
        return;
      }

      if (action === "collect" || action === "yield" || action === "claim") {
        await ctx.defer(true);
        const result = await relics.claimYield(ctx.guild.id, ctx.author.id);
        await ctx.reply({
          content: `💎 Collected **${formatSc(result.amount)}** from ${result.cards} relic${result.cards === 1 ? "" : "s"}. Your vault keeps earning while you hold.`,
        });
        return;
      }

      if (action === "top" || action === "leaderboard") {
        await ctx.defer();
        await ctx.reply(await relics.leaderboardPayload(ctx.guild.id));
        return;
      }

      if (action === "trade" || action === "offer") {
        const partnerId = tradeTarget(ctx.args[1]);
        const offer = parseSerial(ctx.args[2]);
        if (!offer) throw new UserError("Usage: `/relics trade user:@member offer:<your serial> [request:<their serial>] [coins:<amount>]`.");
        if (partnerId === ctx.author.id) throw new UserError("You cannot trade with yourself.");
        const partner = await ctx.guild.members.fetch(partnerId).catch(() => null);
        if (!partner || partner.user.bot) throw new UserError("Choose another human member.");
        let request: number | null = null;
        let coins = 0;
        if (ctx.source === "slash" && ctx.interaction?.isChatInputCommand()) {
          request = ctx.interaction.options.getInteger("request");
          coins = ctx.interaction.options.getInteger("coins") ?? 0;
        } else {
          const tail = ctx.args.slice(3);
          const coinTokenIndex = tail.findIndex((arg) => /^coins?:/i.test(arg));
          if (coinTokenIndex >= 0) {
            const token = tail.splice(coinTokenIndex, 1)[0] ?? "";
            coins = Number(token.split(":")[1] ?? 0);
          }
          const rawRequest = (tail[0] ?? "").toLowerCase();
          request = ["", "none", "0", "gift"].includes(rawRequest) ? null : parseSerial(tail[0]);
          if (rawRequest && !["", "none", "0", "gift"].includes(rawRequest) && !request) {
            throw new UserError("The requested relic serial is invalid. Use `none` for a gift.");
          }
          if (coinTokenIndex < 0 && tail[1] != null) coins = Number(tail[1]);
        }
        if (!Number.isInteger(coins) || coins < 0) throw new UserError("Coins must be a positive whole number.");
        if (!ctx.channel.isTextBased()) throw new UserError("Run this in a text channel.");
        await ctx.defer(true);
        const trade = await relics.createTrade({
          guild: ctx.guild,
          channel: ctx.channel as GuildTextBasedChannel,
          proposerId: ctx.author.id,
          partnerId,
          offerSerial: offer,
          requestSerial: request,
          coins,
        });
        await ctx.reply({
          content: `🔁 Trade offer sent to <@${partnerId}>. It expires <t:${Math.floor(trade.expiresAt.getTime() / 1000)}:R>.`,
        });
        return;
      }

      if (action === "rules" || action === "help") {
        await ctx.reply(relics.rulesPayload());
        return;
      }

      if (action === "channel" || action === "setup") {
        requireAdmin(ctx);
        const raw = ctx.args[1] ?? "";
        const channelId = raw.replace(/^<#/, "").replace(/>$/, "").trim();
        if (!/^\d{17,20}$/.test(channelId)) throw new UserError("Usage: `/relics channel channel:#relic-vault`.");
        const channel = await ctx.guild.channels.fetch(channelId).catch(() => null);
        if (
          !channel ||
          (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)
        ) {
          throw new UserError("Choose a normal text channel.");
        }
        const me = ctx.guild.members.me;
        const permissions = me ? channel.permissionsFor(me) : null;
        const required = [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AddReactions,
        ];
        if (!permissions || required.some((permission) => !permissions.has(permission))) {
          throw new UserError(
            "I need View Channel, Send Messages, Attach Files, Read Message History, and Add Reactions in that channel.",
          );
        }
        const pingRaw = ctx.args[2]?.replace(/^<@&/, "").replace(/>$/, "").trim();
        let pingRoleId: string | null = null;
        if (ctx.source === "slash" && ctx.interaction?.isChatInputCommand()) {
          const role = ctx.interaction.options.getRole("ping");
          if (role) {
            if (role.id === ctx.guild.id) throw new UserError("Choose a normal role for auction pings.");
            pingRoleId = role.id;
          }
        } else if (pingRaw) {
          if (!/^\d{17,20}$/.test(pingRaw)) throw new UserError("Choose a valid ping role.");
          const role = await ctx.guild.roles.fetch(pingRaw).catch(() => null);
          if (!role || role.id === ctx.guild.id) throw new UserError("Choose a normal role for auction pings.");
          pingRoleId = role.id;
        }
        await relics.configureChannel(ctx.guild.id, channel.id, ctx.author.id);
        await relics.setPingRole(ctx.guild.id, pingRoleId, ctx.author.id);
        await ctx.reply(
          success(
            `Relic auctions will run in <#${channel.id}> every day from 4:00 PM to 5:00 PM IST.${
              pingRoleId ? ` Pings will mention <@&${pingRoleId}>.` : " Auction pings are cleared."
            }`,
          ),
        );
        return;
      }

      if (action === "disable" || action === "pause") {
        requireAdmin(ctx);
        await relics.setEnabled(ctx.guild.id, false, ctx.author.id);
        await ctx.reply(success("Daily relic auctions paused. The vault keeps existing cards and yield."));
        return;
      }

      if (action === "enable" || action === "resume") {
        requireAdmin(ctx);
        const settings = await relics.getSettings(ctx.guild.id);
        if (!settings.channelId) throw new UserError("Set an auction channel first with `/relics channel`.");
        await relics.setEnabled(ctx.guild.id, true, ctx.author.id);
        await ctx.reply(success("Daily relic auctions resumed."));
        return;
      }

      if (action === "config" || action === "settings") {
        requireAdmin(ctx);
        const settings = await relics.getSettings(ctx.guild.id);
        const summary = await relics.guildSummary(ctx.guild.id);
        const now = new Date();
        const window = relicDropWindow(now, {
          startHourIst: settings.startHourIst,
          durationMinutes: settings.durationMinutes,
          startingBid: settings.startingBid,
          minIncrement: settings.minIncrement,
        });
        const next = nextRelicDropAt(now, {
          startHourIst: settings.startHourIst,
          durationMinutes: settings.durationMinutes,
          startingBid: settings.startingBid,
          minIncrement: settings.minIncrement,
        });
        const nextDrop =
          now.getTime() >= window.start.getTime() && now.getTime() < window.end.getTime()
            ? "window open now"
            : `<t:${Math.floor(next.getTime() / 1000)}:R>`;
        await ctx.reply({
          ...card({
            title: "Relic vault configuration",
            body: [
              `**Status** · ${settings.enabled ? "enabled" : "paused"}`,
              `**Channel** · ${settings.channelId ? `<#${settings.channelId}>` : "not set"}`,
              `**Window** · ${settings.startHourIst}:00 IST for ${settings.durationMinutes} minutes`,
              `**Starting bid** · ${formatSc(settings.startingBid)}`,
              `**Minimum raise** · ${formatSc(settings.minIncrement)}`,
              `**Ping role** · ${settings.pingRoleId ? `<@&${settings.pingRoleId}>` : "none"}`,
              `**Minted relics** · ${summary.cards} (${summary.legendary} legendary, ${summary.mythic} mythic)`,
              `**Next drop** · ${nextDrop}`,
              "",
              "-# Saturday and Sunday roll a richer rarity table. Genesis serials #0001–#0010 earn double yield.",
            ].join("\n"),
          }),
          ephemeral: true,
        });
        return;
      }

      if (action === "start") {
        requireAdmin(ctx);
        const minutes = ctx.args[1] ? Number(ctx.args[1]) : undefined;
        if (minutes != null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 180)) {
          throw new UserError("Minutes must be between 1 and 180.");
        }
        await ctx.defer();
        const auction = await relics.startAuctionNow(ctx.guild, minutes);
        await ctx.reply(
          success(
            `Bonus relic auction started (auction ${auction.id}) for ${
              minutes != null ? `${minutes} minutes` : "the configured window"
            }.`,
          ),
        );
        return;
      }

      if (action === "end") {
        requireAdmin(ctx);
        await ctx.defer();
        const settled = await relics.endAuctionNow(ctx.guild.id, ctx.author.id);
        await ctx.reply(
          success(
            settled?.winnerId
              ? `Auction ended. <@${settled.winnerId}> won for ${formatSc(settled.winningBid ?? 0)}.`
              : "Auction ended with no bids.",
          ),
        );
        return;
      }

      if (action === "cancel") {
        requireAdmin(ctx);
        await ctx.defer();
        const cancelled = await relics.cancelAuctionNow(ctx.guild.id, ctx.author.id);
        await ctx.reply(success(cancelled ? "Auction cancelled and all live bids refunded." : "No live auction to cancel."));
        return;
      }

      if (action === "grant") {
        requireAdmin(ctx);
        const member = await targetMember(ctx, ctx.args[1]);
        if (member.user.bot) throw new UserError("Choose a human member.");
        const rawRarity = (ctx.args[2] ?? "").toLowerCase();
        const rarity = rawRarity && (RELIC_RARITY_ORDER as string[]).includes(rawRarity)
          ? (rawRarity as RelicRarity)
          : undefined;
        if (rawRarity && !rarity) throw new UserError(`Rarity must be one of: ${RELIC_RARITY_ORDER.join(", ")}.`);
        await ctx.defer();
        const minted = await relics.grantCard(ctx.guild.id, member.id, rarity, ctx.author.id);
        await ctx.reply(
          success(
            `Minted ${RELIC_RARITIES[minted.rarity as RelicRarity].label} ${minted.emoji} **${minted.name}** (${relicSerialLabel(minted.id)}) to ${member.displayName}.`,
          ),
        );
        return;
      }

      throw new UserError(
        "Unknown relic action. Try `/relics auction`, `bid`, `collection`, `card`, `profile`, `collect`, `top`, or `trade`.",
      );
    } catch (error) {
      if (error instanceof RelicError) throw new UserError(relicErrorMessage(error));
      throw error;
    }
  },
};
