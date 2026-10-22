import { SlashCommandBuilder } from "discord.js";
import type { Command, CommandContext } from "../../framework/types.js";
import { isAdmin } from "../../framework/permissions.js";
import { UserError } from "../../lib/errors.js";
import { card, success } from "../../features/ui.js";

const GLOBAL_SHOP = [
  { key: "tambola_ticket", name: "Tambola ticket", price: 25, description: "Buy an extra ticket in the current Tambola lobby." },
  { key: "tambola_automark", name: "Tambola auto-mark", price: 10, description: "Enable auto-marking for all of your tickets." },
  { key: "premium_30d", name: "Premium (30 days)", price: 2000, description: "Grant 30 days of premium perks." },
];

function formatCoins(value: number): string {
  return `${value.toLocaleString()} SC`;
}

export const economyCommand: Command = {
  name: "economy",
  aliases: ["eco", "coins", "balance"],
  category: "utility",
  description: "Siela economy: balance, daily rewards, transfers, and leaderboard.",
  usage: "<balance|daily|work|transfer|top|premium|grant|adjust> ...",
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
    .addSubcommand((sub) => sub.setName("adjust").setDescription("Adjust a balance (admin)").addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true)).addIntegerOption((o) => o.setName("amount").setDescription("Amount, can be negative").setRequired(true)).addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true))),
  async execute(ctx) {
    const economy = ctx.services.economy;
    const action = (ctx.args[0] ?? "balance").toLowerCase();

    if (action === "balance" || action === "bal") {
      const targetId = ctx.args[1] ?? ctx.author.id;
      if (targetId === ctx.author.id || ctx.args[1]) {
        // allow
      }
      const target = targetId === ctx.author.id ? ctx.member : await ctx.guild.members.fetch(targetId).catch(() => null);
      if (!target) throw new UserError("Choose a valid member.");
      const data = await economy.getBalance(ctx.guild.id, target.id);
      await ctx.reply(
        card({
          title: `${target.displayName}'s balance`,
          body: [
            `**Balance** · ${formatCoins(data.balance)}`,
            `**Daily streak** · ${data.dailyStreak} day${data.dailyStreak === 1 ? "" : "s"}`,
            `**Last daily** · ${data.lastDailyAt ? data.lastDailyAt.toISOString().slice(0, 10) : "never"}`,
          ].join("\n"),
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
      const targetId = ctx.args[1];
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
      const rows = await economy.leaderboard(ctx.guild.id, 10);
      if (!rows.length) {
        await ctx.reply({ content: "No economy accounts yet.", ephemeral: true });
        return;
      }
      const names = await Promise.all(rows.map(async (row) => {
        const member = await ctx.guild.members.fetch(row.userId).catch(() => null);
        return member?.displayName ?? row.userId;
      }));
      const body = rows.map((row, index) => `${index + 1}. ${names[index]} — ${formatCoins(row.balance)}`).join("\n");
      await ctx.reply(card({ title: "Coin leaderboard", body }));
      return;
    }


    if (action === "shop") {
      const lines = GLOBAL_SHOP.map((item) => `**${item.name}** (\`${item.key}\`) — ${formatCoins(item.price)}\n-# ${item.description}`);
      const dbItems = await economy.listShopItems(ctx.guild.id);
      if (dbItems.length) {
        lines.push("", "**Server shop**");
        for (const item of dbItems) {
          const stock = item.stock === null ? "unlimited" : `${item.stock} left`;
          lines.push(`**${item.name}** (\`${item.key}\`) — ${formatCoins(item.price)} · ${stock}${item.description ? `\n-# ${item.description}` : ""}`);
        }
      }
      await ctx.reply(card({ title: "Economy shop", body: lines.join("\n") }));
      return;
    }

    if (action === "buy") {
      const key = (ctx.args[1] ?? "").toLowerCase();
      if (!key) throw new UserError("Usage: `economy buy <item>`.");

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
        try {
          await economy.spend(ctx.guild.id, ctx.author.id, 2000, "premium_purchase", `${ctx.guild.id}:${ctx.author.id}:premium:${Date.now()}`);
          const expiresAt = await economy.grantPremium(ctx.guild.id, ctx.author.id, 30, ctx.author.id);
          await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, source: "discord", action: "economy.premium.purchase", targetType: "user", targetId: ctx.author.id, after: { days: 30 } });
          await ctx.reply(success(`Premium granted until ${expiresAt.toISOString().slice(0, 10)}.`));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Purchase failed.";
          if (message === "INSUFFICIENT_FUNDS") throw new UserError("You need 2000 SC for premium.");
          throw new UserError(message);
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
      const key = ctx.args[1];
      const price = Number(ctx.args[2]);
      const slash = ctx.source === "slash";
      const name = slash ? String(ctx.args[3] ?? "").trim() : ctx.args.slice(3).join(" ").trim();
      const roleId = slash && ctx.args[4] && /^\d{17,20}$/.test(ctx.args[4]) ? ctx.args[4] : null;
      const stock = slash && ctx.args[5] && /^\d+$/.test(ctx.args[5]) ? Number(ctx.args[5]) : null;
      const description = slash && ctx.args[6] ? ctx.args.slice(6).join(" ").trim() : null;
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
      if (side !== "heads" && side !== "tails") throw new UserError("Choose heads or tails.");
      try {
        await economy.spend(ctx.guild.id, ctx.author.id, amount, "coinflip", `${ctx.guild.id}:${ctx.author.id}:coinflip:${Date.now()}`);
      } catch (error) {
        if (error instanceof Error && error.message === "INSUFFICIENT_FUNDS") throw new UserError("You do not have enough coins.");
        throw new UserError(error instanceof Error ? error.message : "Bet failed.");
      }
      const win = Math.random() < 0.45;
      if (win) {
        await economy.award(ctx.guild.id, ctx.author.id, amount * 2, "coinflip_win", `${ctx.guild.id}:${ctx.author.id}:coinflipwin:${Date.now()}`);
        await ctx.reply(success(`Coin: **${side}**. You win ${formatCoins(amount * 2)}!`));
      } else {
        const other = side === "heads" ? "tails" : "heads";
        await ctx.reply(success(`Coin: **${other}**. You lose ${formatCoins(amount)}.`));
      }
      return;
    }

    if (action === "slots" || action === "slot") {
      const amount = Number(ctx.args[1]);
      if (!Number.isInteger(amount) || amount <= 0) throw new UserError("Usage: `economy slots <amount>`.");
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
      else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) payout = 2;
      if (payout > 0) {
        await economy.award(ctx.guild.id, ctx.author.id, amount * payout, "slots_win", `${ctx.guild.id}:${ctx.author.id}:slots:${Date.now()}`);
      }
      await ctx.reply(card({ title: "Slots", body: `${reels.join("  ")}\n\n${payout > 0 ? `You win ${formatCoins(amount * payout)}!` : `You lose ${formatCoins(amount)}.`}` }));
      return;
    }

    if (action === "blackjack" || action === "bj") {
      const amount = Number(ctx.args[1]);
      if (!Number.isInteger(amount) || amount <= 0) throw new UserError("Usage: `economy blackjack <amount>`.");
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
      await ctx.reply(card({ title: "Premium", body: has ? "You have an active premium pass." : "You do not have an active premium pass." }));
      return;
    }

    if (action === "grant") {
      if (!isAdmin(ctx.member, ctx.services.config, ctx.guild)) {
        throw new UserError("You need admin permissions for that.");
      }
      const targetId = ctx.args[1];
      const days = Number(ctx.args[2]);
      if (!targetId || !Number.isInteger(days) || days < 1) {
        throw new UserError("Usage: `economy grant <user> <days>`.");
      }
      const target = await ctx.guild.members.fetch(targetId).catch(() => null);
      if (!target) throw new UserError("Choose a valid member.");
      const expiresAt = await economy.grantPremium(ctx.guild.id, target.id, days, ctx.author.id);
      await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, source: "discord", action: "economy.premium.grant", targetType: "user", targetId: target.id, after: { days } });
      await ctx.reply(success(`Granted ${days} premium days to ${target.displayName} until ${expiresAt.toISOString().slice(0, 10)}.`));
      return;
    }

    if (action === "adjust") {
      if (!isAdmin(ctx.member, ctx.services.config, ctx.guild)) {
        throw new UserError("You need admin permissions for that.");
      }
      const targetId = ctx.args[1];
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
      await ctx.reply(success(`Adjusted ${target.displayName}'s balance by ${amount > 0 ? "+" : ""}${amount} SC.`));
      return;
    }

    throw new UserError("Use `economy balance`, `daily`, `work`, `coinflip`, `slots`, `blackjack`, `transfer`, `top`, `shop`, `buy`, `premium`, `grant`, `adjust`, `shopadd`, or `shopremove`.");
  },
};
