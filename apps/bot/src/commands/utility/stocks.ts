import { SlashCommandBuilder } from "discord.js";
import type { Command, CommandContext } from "../../framework/types.js";
import { UserError } from "../../lib/errors.js";
import {
  marketPayload,
  portfolioPayload,
  tradeErrorMessage,
  tradeResultMessage,
} from "../../features/stocks-ui.js";
import { success } from "../../features/ui.js";

function coins(value: number): string {
  return `${value.toLocaleString()} SC`;
}

export const stocksCommand: Command = {
  name: "stocks",
  aliases: ["stock", "market", "invest"],
  category: "utility",
  description: "Siela Exchange: hourly meme stocks, portfolio, buy, and sell.",
  usage: "<market|portfolio|buy|sell> [symbol] [shares]",
  examples: ["stocks", "stocks portfolio", "stocks buy DELULU 10", "stocks sell DELULU 5"],
  cooldownMs: 2_000,
  slash: new SlashCommandBuilder()
    .setName("stocks")
    .setDescription("Siela Exchange")
    .addSubcommand((sub) => sub.setName("market").setDescription("Show the market"))
    .addSubcommand((sub) => sub.setName("portfolio").setDescription("Show your portfolio"))
    .addSubcommand((sub) =>
      sub
        .setName("buy")
        .setDescription("Buy shares")
        .addStringOption((option) =>
          option.setName("symbol").setDescription("Stock symbol").setRequired(true),
        )
        .addIntegerOption((option) =>
          option.setName("shares").setDescription("Number of shares").setRequired(true).setMinValue(1),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("sell")
        .setDescription("Sell shares")
        .addStringOption((option) =>
          option.setName("symbol").setDescription("Stock symbol").setRequired(true),
        )
        .addIntegerOption((option) =>
          option.setName("shares").setDescription("Number of shares").setRequired(true).setMinValue(1),
        ),
    ),
  async execute(ctx: CommandContext) {
    const economy = ctx.services.economy;
    const action = (ctx.args[0] ?? "market").toLowerCase();

    if (action === "market" || action === "board" || action === "index") {
      const market = await economy.getMarket(ctx.guild.id);
      await ctx.reply(marketPayload(market));
      return;
    }

    if (action === "portfolio" || action === "port" || action === "holdings") {
      const portfolio = await economy.getPortfolio(ctx.guild.id, ctx.author.id);
      await ctx.reply({ ...portfolioPayload(portfolio), ephemeral: true });
      return;
    }

    if (action === "buy" || action === "sell") {
      const symbol = (ctx.args[1] ?? "").toUpperCase();
      const shares = Number(ctx.args[2]);
      if (!symbol || !Number.isSafeInteger(shares) || shares <= 0) {
        throw new UserError(`Usage: \`stocks ${action} <symbol> <shares>\`.`);
      }
      try {
        if (action === "buy") {
          const result = await economy.buyStock(ctx.guild.id, ctx.author.id, symbol, shares);
          await ctx.reply(success(tradeResultMessage(result)));
        } else {
          const result = await economy.sellStock(ctx.guild.id, ctx.author.id, symbol, shares);
          await ctx.reply(success(tradeResultMessage(result)));
        }
      } catch (cause) {
        throw new UserError(tradeErrorMessage(cause));
      }
      return;
    }

    throw new UserError("Use `stocks`, `stocks portfolio`, `stocks buy <symbol> <shares>`, or `stocks sell <symbol> <shares>`.");
  },
};
