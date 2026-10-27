import { styleMessage } from "./ui.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { ReplyPayload } from "../framework/types.js";
import type { EconomyService } from "./economy.js";
import { changePct, sparkline, type MarketView, type PortfolioView, type StockBuyResult, type StockSellResult } from "./stocks.js";
import { actionRow, card, error, success } from "./ui.js";

function signed(value: number, digits = 1): string {
  const rounded = value.toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded;
}

function coins(value: number): string {
  return `${value.toLocaleString()} SC`;
}

export function marketPayload(view: MarketView): ReplyPayload {
  const lines: string[] = [];
  for (const stock of view.stocks) {
    lines.push(`**${stock.symbol}** · ${coins(stock.price)} · ${signed(changePct(stock.history))}%`);
    lines.push(`\`${sparkline(stock.history)}\` ${stock.name}`);
  }

  const latest = view.stocks
    .filter((stock) => stock.lastEvent && stock.lastEventAt)
    .sort((a, b) => (b.lastEventAt?.getTime() ?? 0) - (a.lastEventAt?.getTime() ?? 0))[0];
  const updated = Math.floor(view.lastTickAt.getTime() / 1000);
  const body = [
    `**SIELA-6** · ${view.index.toFixed(1)} · ${signed(view.indexChange)}%`,
    `-# Hourly prices · 1% fee, minimum 1 SC · last tick <t:${updated}:R>`,
    "",
    ...lines,
  ].join("\n");

  return card({ theme: "economy",
    title: "Siela Exchange",
    body: latest?.lastEvent ? `${body}\n\n-# Latest: ${latest.lastEvent}` : body,
    rows: [
      actionRow(
        new ButtonBuilder()
          .setCustomId("stocks:view:portfolio")
          .setLabel("Portfolio")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("stocks:trade:buy")
          .setLabel("Buy")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("stocks:trade:sell")
          .setLabel("Sell")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

export function portfolioPayload(view: PortfolioView): ReplyPayload {
  const lines = view.holdings.length
    ? view.holdings.map((holding) =>
        [
          `**${holding.symbol}** · ${holding.shares.toLocaleString()} shares · ${coins(holding.value)}`,
          `-# Avg ${coins(holding.avgCost)} · Now ${coins(holding.price)} · ${signed(holding.pnl)} SC (${signed(holding.pnlPct)}%)`,
        ].join("\n"),
      )
    : ["No positions yet. Buy your first stock from the market."];

  return card({ theme: "economy",
    title: "Portfolio",
    subtitle: `Cash ${coins(view.cash)} · Holdings ${coins(view.holdingsValue)} · Net ${coins(view.netWorth)}`,
    body: [`**Unrealized** · ${signed(view.unrealized)} SC`, "", ...lines].join("\n"),
    rows: [
      actionRow(
        new ButtonBuilder()
          .setCustomId("stocks:view:market")
          .setLabel("Market")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("stocks:trade:buy")
          .setLabel("Buy")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("stocks:trade:sell")
          .setLabel("Sell")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

export function stockModal(side: "buy" | "sell"): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`stocks:modal:${side}`)
    .setTitle(side === "buy" ? "Buy stock" : "Sell stock")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("symbol")
          .setLabel("Symbol")
          .setPlaceholder("DELULU")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(8),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("shares")
          .setLabel("Shares")
          .setPlaceholder("10")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(7),
      ),
    );
}

export function tradeErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "";
  switch (message) {
    case "UNKNOWN_STOCK":
      return "That symbol is not on the exchange.";
    case "INVALID_SHARES":
      return "Shares must be a positive whole number.";
    case "INSUFFICIENT_FUNDS":
      return "You do not have enough SC for that trade.";
    case "NOT_ENOUGH_SHARES":
      return "You do not own that many shares.";
    case "TRADE_TOO_SMALL":
      return "That trade is too small after the fee.";
    case "AMOUNT_TOO_LARGE":
      return "That trade is too large.";
    default:
      return "The trade failed.";
  }
}

export function tradeResultMessage(result: StockBuyResult): string;
export function tradeResultMessage(result: StockSellResult): string;
export function tradeResultMessage(result: StockBuyResult | StockSellResult): string {
  if ("pnl" in result) {
    return `Sold ${result.shares} ${result.symbol} at ${coins(result.price)}. Fee ${coins(result.fee)}. P/L ${signed(result.pnl)} SC. Balance ${coins(result.balance)}.`;
  }
  return `Bought ${result.shares} ${result.symbol} at ${coins(result.price)}. Fee ${coins(result.fee)}. Balance ${coins(result.balance)}.`;
}

export async function handleStockButton(
  economy: EconomyService,
  interaction: ButtonInteraction,
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) return;

  if (interaction.customId === "stocks:view:portfolio") {
    const portfolio = await economy.getPortfolio(guildId, interaction.user.id);
    await interaction.reply(styleMessage({ ...portfolioPayload(portfolio), ephemeral: true }));
    return;
  }
  if (interaction.customId === "stocks:view:market") {
    const market = await economy.getMarket(guildId);
    await interaction.reply(styleMessage({ ...marketPayload(market), ephemeral: true }));
    return;
  }
  if (interaction.customId === "stocks:trade:buy") {
    await interaction.showModal(stockModal("buy"));
    return;
  }
  if (interaction.customId === "stocks:trade:sell") {
    await interaction.showModal(stockModal("sell"));
    return;
  }
}

export async function handleStockModal(
  economy: EconomyService,
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const side = interaction.customId.split(":")[2];
  if (side !== "buy" && side !== "sell") return;
  const guildId = interaction.guildId;
  if (!guildId) return;

  const symbol = interaction.fields.getTextInputValue("symbol").trim();
  const shares = Number(interaction.fields.getTextInputValue("shares").trim());
  if (!Number.isSafeInteger(shares) || shares <= 0) {
    await interaction.reply(styleMessage({ ...error("Shares must be a positive whole number."), ephemeral: true }));
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    if (side === "buy") {
      const result = await economy.buyStock(guildId, interaction.user.id, symbol, shares);
      await interaction.editReply(styleMessage(success(tradeResultMessage(result))));
      return;
    }
    const result = await economy.sellStock(guildId, interaction.user.id, symbol, shares);
    await interaction.editReply(styleMessage(success(tradeResultMessage(result))));
  } catch (cause) {
    await interaction.editReply(styleMessage(error(tradeErrorMessage(cause))));
  }
}
