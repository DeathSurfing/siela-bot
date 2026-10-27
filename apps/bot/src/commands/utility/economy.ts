import { SlashCommandBuilder } from "discord.js";
import type { Command, CommandContext } from "../../framework/types.js";
import { isAdmin } from "../../framework/permissions.js";
import { UserError } from "../../lib/errors.js";
import {
  attachPagination,
  card,
  empty,
  fetchMemberNames,
  pagedCard,
  rankLabel,
  success,
} from "../../features/ui.js";

const MAX_BET = 10_000;

const GLOBAL_SHOP = [
  { key: "delulu", name: "Delulu", price: 5, category: "AI", purchasable: false, description: "Per use, doubling each day: 5, 10, 20, 40 SC." },
  { key: "delulu_nsfw", name: "Delulu NSFW", price: 15, category: "AI", purchasable: false, description: "Per use, doubling each day: 15, 30, 60, ... SC. No daily cap." },
  { key: "tambola_ticket", name: "Tambola ticket", price: 25, category: "Tambola", purchasable: true, description: "Buy an extra ticket in the current Tambola lobby." },
  { key: "tambola_automark", name: "Tambola auto-mark", price: 10, category: "Tambola", purchasable: true, description: "Enable auto-marking for all of your tickets." },
  { key: "premium_30d", name: "Premium (30 days)", price: 2000, category: "Premium", purchasable: true, description: "Grant 30 days of premium perks." },
];

function formatCoins(value: number): string {
  return `${value.toLocaleString()} SC`;
}

export const economyCommand: Command = {
  name: "economy",
  aliases: ["eco", "coins", "balance"],
  category: "utility",
  description: "Siela economy: balance, daily rewards, transfers, games, and leaderboard.",
  usage: "<balance|daily|work|transfer|top|shop|stocks|premium|grant|adjust|stats> ...",
  examples: ["economy daily", "economy work", "economy balance", "economy transfer @user 100", "economy top"],
  cooldownMs: 3_000,
  slash: new SlashCommandBuilder()
    .setName("economy")
    .setDescription("Siela economy")
    .addSubcommand((sub) => sub.setName("balance").setDescription("Show your balance").addUserOption((o) => o.setName("user").setDescription("Member").setRequired(false)))
    .addSubcommand((sub) => sub.setName("daily").setDescription("Claim your daily reward"))
    .addSubcommand((sub) => sub.setName("work").setDescription("Work a shift for coins"))
    .addSubcommand((sub) => sub.setName("transfer").setDescription("Transfer coins").addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true)).addIntegerOption((o) => o.setName("amount").setDescription("Amount").setRequired(true).setMinValue(1)))
    .addSubcommand((sub) => sub.setName("top").setDescription("Show the richest members"))
    .addSubcommand((sub) => sub.setName("coinflip").setDescription("Flip a coin").addIntegerOption((o) => o.setName("amount").setDescription("Bet").setRequired(true).setMinValue(1)).addStringOption((o) => o.setName("side").setDescription("heads or tails").setRequired(true).addChoices({ name: "Heads", value: "heads" }, { name: "Tails", value: "tails" })))
    .addSubcommand((sub) => sub.setName("slots").setDescription("Spin the slots").addIntegerOption((o) => o.setName("amount").setDescription("Bet").setRequired(true).setMinValue(1)))
    .addSubcommand((sub) => sub.setName("blackjack").setDescription("Play blackjack").addIntegerOption((o) => o.setName("amount").setDescription("Bet").setRequired(true).setMinValue(1)))
    .addSubcommand((sub) => sub.setName("shop").setDescription("Show the economy shop"))
    .addSubcommand((sub) => sub.setName("buy").setDescription("Buy a shop item").addStringOption((o) => o.setName("item").setDescription("Item key").setRequired(true)))
    .addSubcommand((sub) => sub.setName("shopadd").setDescription("Add a shop item (admin)").addStringOption((o) => o.setName("key").setDescription("Item key").setRequired(true)).addIntegerOption((o) => o.setName("price").setDescription("Price").setRequired(true).setMinValue(1)).addStringOption((o) => o.setName("name").setDescription("Item name").setRequired(true)).addRoleOption((o) => o.setName("role").setDescription("Role to grant").setRequired(false)).addIntegerOption((o) => o.setName("stock").setDescription("Stock").setRequired(false).setMinValue(1)).addStringOption((o) => o.setName("description").setDescription("Description").setRequired(false)))
    .addSubcommand((sub) => sub.setName("shopremove").setDescription("Remove a shop item (admin)").addStringOption((o) => o.setName("key").setDescription("Item key").setRequired(true)))
    .addSubcommand((sub) => sub.setName("premium").setDescription("Show premium status"))
    .addSubcommand((sub) => sub.setName("grant").setDescription("Grant premium (admin)").addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true)).addIntegerOption((o) => o.setName("days").setDescription("Days").setRequired(true).setMinValue(1)))
    .addSubcommand((sub) => sub.setName("stats").setDescription("Show faucet and sink totals for the last 7 days (admin)"))
    .addSubcommand((sub) => sub.setName("adjust").setDescription("Adjust a balance (admin)").addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true)).addIntegerOption((o) => o.setName("amount").setDescription("Amount, can be negative").setRequired(true)).addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true))),
  async execute(ctx) {
    const economy = ctx.services.economy;
    const action = (ctx.args[0] ?? "balance").toLowerCase();

    if (action === "balance" || action === "bal") {
      const targetId = (ctx.args[1] ?? ctx.author.id).replace(/^<@!?/, "").replace(/>$/, "");
      if (targetId === ctx.author.id || ctx.args[1]) {
        // allow
      }
      const target = targetId === ctx.author.id ? ctx.member : await ctx.guild.members.fetch(targetId).catch(() => null);
      if (!target) throw new UserError("Choose a valid member.");
      const data = await economy.getBalance(ctx.guild.id, target.id);
      await ctx.reply(
        card({ theme: "economy",
          title: `${target.displayName}'s balance`,
          eyebrow: "THE WALLET / SIELA COINS",
          subtitle: "Good things add up.",
          fields: [
            { label: "AVAILABLE BALANCE", value: formatCoins(data.balance) },
            { label: "DAILY STREAK", value: `${data.dailyStreak} day${data.dailyStreak === 1 ? "" : "s"}` },
          ],
          body: `**Last daily** · ${data.lastDailyAt ? `<t:${Math.floor(data.lastDailyAt.getTime() / 1000)}:R>` : "Not claimed yet"}`,
          footer: "Earn a little more with /economy daily or /economy work.",
        }),
      );
      return;
    }

    if (action === "daily") {
      try {
        const result = await economy.daily(ctx.guild.id, ctx.author.id);
        await ctx.reply(success(`Claimed ${formatCoins(result.amount)} (streak x${result.streak}). Next claim: <t:${Math.floor(result.nextAt.getTime() / 1000)}:R>.`));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Daily claim failed.";
        if (message.startsWith("DAILY_COOLDOWN:")) {
          const next = message.slice("DAILY_COOLDOWN:".length);
          throw new UserError(`You already claimed today. Next claim: <t:${Math.floor(new Date(next).getTime() / 1000)}:R>.`);
        }
        throw new UserError(message);
      }
      return;
    }


    if (action === "work") {
      try {
        const result = await economy.work(ctx.guild.id, ctx.author.id);
        await ctx.reply(success(`You earned ${formatCoins(result.amount)} from work. Next shift: <t:${Math.floor(result.nextAt.getTime() / 1000)}:R>.`));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Work failed.";
        if (message.startsWith("WORK_COOLDOWN:")) {
          const next = message.slice("WORK_COOLDOWN:".length);
          throw new UserError(`You are tired. Next shift: <t:${Math.floor(new Date(next).getTime() / 1000)}:R>.`);
        }
        throw new UserError(message);
      }
      return;
    }

    if (action === "transfer" || action === "give" || action === "pay") {
      const targetId = (ctx.args[1] ?? "").replace(/^<@!?/, "").replace(/>$/, "");
      const amount = Number(ctx.args[2]);
      if (!targetId) throw new UserError("Usage: `economy transfer <user> <amount>`.");
      if (!Number.isInteger(amount) || amount <= 0) throw new UserError("Amount must be a positive number.");
      const target = await ctx.guild.members.fetch(targetId).catch(() => null);
      if (!target || target.user.bot || target.id === ctx.author.id) {
        throw new UserError("Choose a different human member.");
      }
      try {
        await economy.transfer(ctx.guild.id, ctx.author.id, target.id, amount);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Transfer failed.";
        if (message === "INSUFFICIENT_FUNDS") throw new UserError("You do not have enough coins.");
        if (message === "AMOUNT_TOO_LARGE") throw new UserError("Amount is too large.");
        throw new UserError(message);
      }
      await ctx.reply(success(`Transferred ${formatCoins(amount)} to ${target.displayName}.`));
      return;
    }

    if (action === "top" || action === "baltop" || action === "leaderboard") {
      const rows = await economy.leaderboard(ctx.guild.id, 100);
      if (!rows.length) {
        await ctx.reply(empty("No economy accounts yet."));
        return;
      }
      const names = await fetchMemberNames(ctx.guild, rows.map((row) => row.userId));
      const pageSize = 10;
      const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
      const buildPage = (page: number, disabled = false) => {
        const start = (page - 1) * pageSize;
        const body = rows
          .slice(start, start + pageSize)
          .map((row, index) => {
            const rank = start + index + 1;
            return `${rankLabel(rank)} **${names.get(row.userId) ?? row.userId}** — ${formatCoins(row.balance)}`;
          })
          .join("\n");
        return pagedCard({
          title: "Coin leaderboard",
          subtitle: `Top ${rows.length} by Siela Coins`,
          body,
          page,
          totalPages,
          disabled,
        });
      };
      const message = await ctx.reply(buildPage(1));
      if (message) attachPagination(message, ctx.author.id, 1, buildPage);
      return;
    }


    if (action === "shop") {
      const categories = [...new Set(GLOBAL_SHOP.map((item) => item.category))];
      const lines: string[] = [];
      for (const category of categories) {
        lines.push(`**${category}**`);
        for (const item of GLOBAL_SHOP.filter((entry) => entry.category === category)) {
          lines.push(item.purchasable ? `**${item.name}** · ${formatCoins(item.price)} · \`${item.key}\`` : `**${item.name}** · ${formatCoins(item.price)} · per use`);
          lines.push(`-# ${item.description}`);
        }
        lines.push("");
      }
      const dbItems = await economy.listShopItems(ctx.guild.id);
      if (dbItems.length) {
        lines.push("**Server shop**");
        for (const item of dbItems) {
          const stock = item.stock === null ? "unlimited" : `${item.stock} left`;
          lines.push(`**${item.name}** · ${formatCoins(item.price)} · \`${item.key}\` · ${stock}`);
          if (item.description) lines.push(`-# ${item.description}`);
        }
      }
      await ctx.reply(card({ theme: "economy", title: "Economy shop", body: lines.join("\n").trim() }));
      return;
    }

    if (action === "buy") {
      const key = (ctx.args[1] ?? "").toLowerCase();
      if (!key) throw new UserError("Usage: `economy buy <item>`.");

      const globalItem = GLOBAL_SHOP.find((item) => item.key === key);
      if (globalItem && !globalItem.purchasable) {
        throw new UserError(`${globalItem.name} costs ${formatCoins(globalItem.price)} per use. It is charged automatically when you use it.`);
      }

      if (key === "tambola_ticket") {
        try {
          const count = await ctx.services.tambola.buyTicket(ctx.guild.id, ctx.author.id);
          await ctx.reply(success(`Bought a Tambola ticket. You now have ${count}.`));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Purchase failed.";
          if (message === "INSUFFICIENT_FUNDS") throw new UserError("You need 25 SC to buy a ticket.");
          throw new UserError(message);
        }
        return;
      }
      if (key === "tambola_automark") {
        try {
          await ctx.services.tambola.buyAutoMark(ctx.guild.id, ctx.author.id);
          await ctx.reply(success("Bought auto-marking for all of your tickets."));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Purchase failed.";
          if (message === "INSUFFICIENT_FUNDS") throw new UserError("You need 10 SC to buy auto-marking.");
          throw new UserError(message);
        }
        return;
      }
      if (key === "premium_30d") {
        let spent = false;
        const paymentId = `${ctx.guild.id}:${ctx.author.id}:premium:${Date.now()}`;
        try {
          await economy.spend(ctx.guild.id, ctx.author.id, 2000, "premium_purchase", paymentId);
          spent = true;
          const expiresAt = await economy.grantPremium(ctx.guild.id, ctx.author.id, 30, ctx.author.id);
          await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, source: "discord", action: "economy.premium.purchase", targetType: "user", targetId: ctx.author.id, after: { days: 30 } });
          await ctx.reply(success(`Premium granted until <t:${Math.floor(expiresAt.getTime() / 1000)}:D>.`));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Purchase failed.";
          if (spent && message !== "INSUFFICIENT_FUNDS") {
            await economy.award(ctx.guild.id, ctx.author.id, 2000, "premium_refund", `${paymentId}:refund`).catch(() => undefined);
          }
          if (message === "INSUFFICIENT_FUNDS") throw new UserError("You need 2000 SC for premium.");
          throw new UserError(spent ? "Premium grant failed. Your coins have been refunded." : message);
        }
        return;
      }

      try {
        const result = await economy.buyItem(ctx.guild.id, ctx.author.id, key);
        if (result.item.roleId) {
          try {
            await ctx.member.roles.add(result.item.roleId);
          } catch {
            // role grant is best-effort
          }
        }
        await ctx.reply(success(`Bought **${result.item.name}** for ${formatCoins(result.item.price)}.`));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Purchase failed.";
        if (message === "ITEM_NOT_FOUND") throw new UserError("That item does not exist.");
        if (message === "OUT_OF_STOCK") throw new UserError("That item is out of stock.");
        if (message === "INSUFFICIENT_FUNDS") throw new UserError("You do not have enough coins.");
        throw new UserError(message);
      }
      return;
    }

    if (action === "shopadd") {
      if (!isAdmin(ctx.member, ctx.services.config, ctx.guild)) {
        throw new UserError("You need admin permissions for that.");
      }
      const slash = ctx.source === "slash";
      const opts = slash ? (ctx.interaction?.options as any) : null;
      const key = slash ? String(opts?.getString?.("key") ?? ctx.args[1] ?? "").trim() : ctx.args[1];
      const price = slash ? Number(opts?.getInteger?.("price") ?? ctx.args[2]) : Number(ctx.args[2]);
      const name = slash ? String(opts?.getString?.("name") ?? "").trim() : ctx.args.slice(3).join(" ").trim();
      const roleId = slash ? (opts?.getRole?.("role")?.id ?? null) : null;
      const stock = slash ? (opts?.getInteger?.("stock") ?? null) : null;
      const description = slash ? (opts?.getString?.("description") ?? null) : null;
      if (!key || !Number.isInteger(price) || price <= 0 || !name) {
        throw new UserError("Usage: `economy shopadd <key> <price> <name>`.");
      }
      try {
        await economy.addShopItem({
          guildId: ctx.guild.id,
          key,
          name,
          description,
          price,
          roleId,
          stock,
          createdBy: ctx.author.id,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not add item.";
        throw new UserError(message);
      }
      await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, source: "discord", action: "economy.shop.add", targetType: "shop_item", targetId: key, after: { price, name } });
      await ctx.reply(success(`Added shop item \`${key.toLowerCase()}\`.`));
      return;
    }

    if (action === "shopremove") {
      if (!isAdmin(ctx.member, ctx.services.config, ctx.guild)) {
        throw new UserError("You need admin permissions for that.");
      }
      const key = ctx.args[1];
      if (!key) throw new UserError("Usage: `economy shopremove <key>`.");
      const removed = await economy.removeShopItem(ctx.guild.id, key);
      if (!removed) throw new UserError("That item does not exist.");
      await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, source: "discord", action: "economy.shop.remove", targetType: "shop_item", targetId: key });
      await ctx.reply(success(`Removed shop item \`${key}\`.`));
      return;
    }


    if (action === "coinflip" || action === "cf" || action === "flip") {
      const amount = Number(ctx.args[1]);
      const side = String(ctx.args[2] ?? "heads").toLowerCase();
      if (!Number.isInteger(amount) || amount <= 0) throw new UserError("Usage: `economy coinflip <amount> <heads|tails>`.");
      if (amount > MAX_BET) throw new UserError(`The maximum bet is ${MAX_BET.toLocaleString()} SC.`);
      if (side !== "heads" && side !== "tails") throw new UserError("Choose heads or tails.");
      try {
        await economy.spend(ctx.guild.id, ctx.author.id, amount, "coinflip", `${ctx.guild.id}:${ctx.author.id}:coinflip:${Date.now()}`);
      } catch (error) {
        if (error instanceof Error && error.message === "INSUFFICIENT_FUNDS") throw new UserError("You do not have enough coins.");
        throw new UserError(error instanceof Error ? error.message : "Bet failed.");
      }
      const win = Math.random() < 0.48;
      if (win) {
        await economy.award(ctx.guild.id, ctx.author.id, amount * 2, "coinflip_win", `${ctx.guild.id}:${ctx.author.id}:coinflipwin:${Date.now()}`);
        await ctx.reply(success(`Coin: **${side}**. You win ${formatCoins(amount * 2)}!`));
      } else {
        const other = side === "heads" ? "tails" : "heads";
        await ctx.reply({ content: `Coin: **${other}**. You lose ${formatCoins(amount)}.`, ephemeral: true });
      }
      return;
    }

    if (action === "slots" || action === "slot") {
      const amount = Number(ctx.args[1]);
      if (!Number.isInteger(amount) || amount <= 0) throw new UserError("Usage: `economy slots <amount>`.");
      if (amount > MAX_BET) throw new UserError(`The maximum bet is ${MAX_BET.toLocaleString()} SC.`);
      try {
        await economy.spend(ctx.guild.id, ctx.author.id, amount, "slots", `${ctx.guild.id}:${ctx.author.id}:slots:${Date.now()}`);
      } catch (error) {
        if (error instanceof Error && error.message === "INSUFFICIENT_FUNDS") throw new UserError("You do not have enough coins.");
        throw new UserError(error instanceof Error ? error.message : "Bet failed.");
      }
      const symbols = ["🍒", "🍋", "🔔", "⭐", "7️⃣"];
      const reels = [symbols[Math.floor(Math.random() * symbols.length)]!, symbols[Math.floor(Math.random() * symbols.length)]!, symbols[Math.floor(Math.random() * symbols.length)]!];
      let payout = 0;
      if (reels[0] === reels[1] && reels[1] === reels[2]) payout = 5;
      else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) payout = 1.6;
      const winAmount = Math.floor(amount * payout);
      if (winAmount > 0) {
        await economy.award(ctx.guild.id, ctx.author.id, winAmount, "slots_win", `${ctx.guild.id}:${ctx.author.id}:slots:${Date.now()}`);
      }
      await ctx.reply(card({ theme: "economy", title: "Slots", body: `${reels.join("  ")}\n\n${winAmount > 0 ? `You win ${formatCoins(winAmount)}!` : `You lose ${formatCoins(amount)}.`}` }));
      return;
    }

    if (action === "blackjack" || action === "bj") {
      const amount = Number(ctx.args[1]);
      if (!Number.isInteger(amount) || amount <= 0) throw new UserError("Usage: `economy blackjack <amount>`.");
      if (amount > MAX_BET) throw new UserError(`The maximum bet is ${MAX_BET.toLocaleString()} SC.`);
      try {
        const result = await economy.blackjackStart(ctx.guild.id, ctx.author.id, amount);
        await ctx.reply(economy.blackjackPayload(result));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Blackjack failed.";
        if (message === "INSUFFICIENT_FUNDS") throw new UserError("You do not have enough coins.");
        if (message === "BLACKJACK_ACTIVE") throw new UserError("Finish your current blackjack hand first.");
        throw new UserError(message);
      }
      return;
    }

    if (action === "premium") {
      const has = await economy.hasPremium(ctx.guild.id, ctx.author.id);
      await ctx.reply(card({ theme: "economy", title: "Premium", body: has ? "You have an active premium pass." : "You do not have an active premium pass." }));
      return;
    }

    if (action === "grant") {
      if (!isAdmin(ctx.member, ctx.services.config, ctx.guild)) {
        throw new UserError("You need admin permissions for that.");
      }
      const targetId = (ctx.args[1] ?? "").replace(/^<@!?/, "").replace(/>$/, "");
      const days = Number(ctx.args[2]);
      if (!targetId || !Number.isInteger(days) || days < 1) {
        throw new UserError("Usage: `economy grant <user> <days>`.");
      }
      const target = await ctx.guild.members.fetch(targetId).catch(() => null);
      if (!target) throw new UserError("Choose a valid member.");
      const expiresAt = await economy.grantPremium(ctx.guild.id, target.id, days, ctx.author.id);
      await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, source: "discord", action: "economy.premium.grant", targetType: "user", targetId: target.id, after: { days } });
      await ctx.reply(success(`Granted ${days} premium days to ${target.displayName} until <t:${Math.floor(expiresAt.getTime() / 1000)}:D>.`));
      return;
    }

    if (action === "stats") {
      if (!isAdmin(ctx.member, ctx.services.config, ctx.guild)) {
        throw new UserError("You need admin permissions for that.");
      }
      const rows = await economy.stats(ctx.guild.id, 7);
      if (!rows.length) {
        await ctx.reply(empty("No economy transactions in the last 7 days."));
        return;
      }
      const body = rows
        .map((row) => `- \`${row.kind}\` · ${formatCoins(row.total)} · ${row.count} tx`)
        .join("\n");
      await ctx.reply(card({ theme: "economy", title: "Economy activity · 7 days", body }));
      return;
    }

    if (action === "adjust") {
      if (!isAdmin(ctx.member, ctx.services.config, ctx.guild)) {
        throw new UserError("You need admin permissions for that.");
      }
      const targetId = (ctx.args[1] ?? "").replace(/^<@!?/, "").replace(/>$/, "");
      const amount = Number(ctx.args[2]);
      const reason = ctx.args.slice(3).join(" ").trim();
      if (!targetId || !Number.isInteger(amount) || amount === 0 || !reason) {
        throw new UserError("Usage: `economy adjust <user> <amount> <reason>`.");
      }
      const target = await ctx.guild.members.fetch(targetId).catch(() => null);
      if (!target) throw new UserError("Choose a valid member.");
      try {
        await economy.adjust(ctx.guild.id, target.id, amount, reason, ctx.author.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Adjust failed.";
        if (message === "INSUFFICIENT_FUNDS") throw new UserError("That would make the balance negative.");
        throw new UserError(message);
      }
      await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, source: "discord", action: "economy.adjust", targetType: "user", targetId: target.id, after: { amount, reason } });
      await ctx.reply(success(`Adjusted ${target.displayName}'s balance by ${amount > 0 ? "+" : ""}${formatCoins(amount)}.`));
      return;
    }

    throw new UserError("Use `economy balance`, `daily`, `work`, `coinflip`, `slots`, `blackjack`, `transfer`, `top`, `shop`, `buy`, `premium`, `grant`, `stats`, `adjust`, `shopadd`, or `shopremove`. Use `stocks` for the exchange.");
  },
};
