import { SlashCommandBuilder } from "discord.js";
import type { Command, CommandContext } from "../../framework/types.js";
import { isAdmin } from "../../framework/permissions.js";
import { UserError } from "../../lib/errors.js";
import { card, success } from "../../features/ui.js";

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
        await ctx.reply(success(`Claimed ${formatCoins(result.amount)} (streak x${result.streak}). Next claim after ${result.nextAt.toISOString().slice(0, 16).replace("T", " ")}.`));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Daily claim failed.";
        if (message.startsWith("DAILY_COOLDOWN:")) {
          const next = message.slice("DAILY_COOLDOWN:".length);
          throw new UserError(`You already claimed today. Next claim: ${next.slice(0, 16).replace("T", " ")}.`);
        }
        throw new UserError(message);
      }
      return;
    }


    if (action === "work") {
      try {
        const result = await economy.work(ctx.guild.id, ctx.author.id);
        await ctx.reply(success(`You earned ${formatCoins(result.amount)} from work. Next shift after ${result.nextAt.toISOString().slice(0, 16).replace("T", " ")}.`));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Work failed.";
        if (message.startsWith("WORK_COOLDOWN:")) {
          const next = message.slice("WORK_COOLDOWN:".length);
          throw new UserError(`You are tired. Next shift: ${next.slice(0, 16).replace("T", " ")}.`);
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

    throw new UserError("Use `economy balance`, `daily`, `work`, `transfer`, `top`, `premium`, `grant`, or `adjust`.");
  },
};
