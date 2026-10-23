import { describe, expect, it } from "vitest";
import { MessageFlags } from "discord.js";
import { marketPayload, portfolioPayload, tradeResultMessage } from "./stocks-ui.js";
import type { MarketStockView, MarketView, PortfolioView, StockBuyResult, StockSellResult } from "./stocks.js";

const stock: MarketStockView = {
  symbol: "DELULU",
  name: "Delulu Labs",
  sector: "AI",
  description: "Ships a model whenever someone asks.",
  price: 62,
  fairValue: 60,
  history: [54, 56, 58, 60, 62],
  lastEvent: "Delulu Labs ships a model nobody asked for",
  lastEventAt: new Date("2026-10-23T10:00:00Z"),
};

const market: MarketView = {
  stocks: [stock],
  index: 103.3,
  indexChange: 3.3,
  lastTickAt: new Date("2026-10-23T10:00:00Z"),
  nextTickAt: new Date("2026-10-23T11:00:00Z"),
};

const portfolio: PortfolioView = {
  cash: 50,
  holdings: [
    {
      symbol: "DELULU",
      name: "Delulu Labs",
      shares: 10,
      avgCost: 60,
      price: 62,
      value: 620,
      cost: 600,
      pnl: 20,
      pnlPct: 3.3,
    },
  ],
  holdingsValue: 620,
  netWorth: 670,
  unrealized: 20,
};

describe("stock UI payloads", () => {
  it("builds a V2 market card with a sparkline and headline", () => {
    const payload = marketPayload(market);
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    const json = JSON.stringify(payload.components);
    expect(json).toContain("Siela Exchange");
    expect(json).toContain("DELULU");
    expect(json).toContain("Delulu Labs ships a model nobody asked for");
  });

  it("builds an ephemeral-ready portfolio card", () => {
    const payload = portfolioPayload(portfolio);
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    const json = JSON.stringify(payload.components);
    expect(json).toContain("Portfolio");
    expect(json).toContain("620 SC");
    expect(json).toContain("+20.0 SC");
  });

  it("shows an empty state when the portfolio has no holdings", () => {
    const payload = portfolioPayload({ ...portfolio, holdings: [], holdingsValue: 0, unrealized: 0, netWorth: 50 });
    const json = JSON.stringify(payload.components);
    expect(json).toContain("No positions yet");
  });

  it("discloses the minimum market fee", () => {
    const payload = marketPayload(market);
    const json = JSON.stringify(payload.components);
    expect(json).toContain("1% fee, minimum 1 SC");
  });

  it("formats buy and sell trade results identically", () => {
    const buy: StockBuyResult = {
      symbol: "DELULU",
      shares: 10,
      price: 62,
      fee: 6,
      total: 626,
      balance: 100,
    };
    const sell: StockSellResult = {
      symbol: "DELULU",
      shares: 10,
      price: 62,
      fee: 6,
      proceeds: 614,
      pnl: 20,
      balance: 714,
    };
    expect(tradeResultMessage(buy)).toContain("Bought 10 DELULU");
    expect(tradeResultMessage(sell)).toContain("P/L +20.0 SC");
  });
});
