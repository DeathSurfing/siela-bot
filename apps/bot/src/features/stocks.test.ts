import { describe, expect, it } from "vitest";
import {
  MAX_STOCK_PRICE,
  MIN_STOCK_PRICE,
  STOCK_HISTORY_LENGTH,
  STOCK_SEEDS,
  advanceStock,
  changePct,
  indexChange,
  marketIndex,
  nextAverageCost,
  sparkline,
  stockSeed,
  tradeFee,
  type MarketStockView,
  type StockState,
} from "./stocks.js";

const baseState: StockState = {
  symbol: "DELULU",
  price: 60,
  fairValue: 60,
  volatility: 650,
  history: [58, 59, 60],
};

describe("stock market math", () => {
  it("keeps prices inside the configured bounds and trims history", () => {
    const step = advanceStock(baseState, () => 0.999, 0);
    expect(step.price).toBeGreaterThanOrEqual(MIN_STOCK_PRICE);
    expect(step.price).toBeLessThanOrEqual(MAX_STOCK_PRICE);
    expect(step.history).toHaveLength(4);
  });

  it("trims history to the configured length", () => {
    const state: StockState = {
      ...baseState,
      history: Array.from({ length: STOCK_HISTORY_LENGTH }, () => 60),
    };
    const step = advanceStock(state, () => 0.5, 0);
    expect(step.history).toHaveLength(STOCK_HISTORY_LENGTH);
    expect(step.history.at(-1)).toBe(step.price);
  });

  it("can emit a headline event", () => {
    const step = advanceStock(baseState, () => 0, 1);
    expect(step.event).toBeTruthy();
    expect(step.price).not.toBe(baseState.price);
  });

  it("does not emit an event when the chance is zero", () => {
    const step = advanceStock(baseState, () => 0.5, 0);
    expect(step.event).toBeNull();
  });

  it("renders a sparkline with one glyph per price", () => {
    expect(sparkline([10, 20, 30, 40], 4)).toHaveLength(4);
    expect(sparkline([])).toBe("▱▱▱▱▱▱▱▱▱▱▱▱");
  });

  it("computes percentage change from the first to the last price", () => {
    expect(changePct([100, 110])).toBeCloseTo(10);
    expect(changePct([100])).toBe(0);
    expect(changePct([])).toBe(0);
  });

  it("values the index at 100 when every stock is at its base price", () => {
    const stocks = STOCK_SEEDS.map((seed) => ({
      symbol: seed.symbol,
      name: seed.name,
      sector: seed.sector,
      description: seed.description,
      price: seed.basePrice,
      fairValue: seed.basePrice,
      history: [seed.basePrice, seed.basePrice],
      lastEvent: null,
      lastEventAt: null,
    })) satisfies MarketStockView[];
    expect(marketIndex(stocks)).toBeCloseTo(100);
    expect(indexChange(stocks)).toBeCloseTo(0);
  });

  it("charges a one percent fee with a one coin floor", () => {
    expect(tradeFee(10)).toBe(1);
    expect(tradeFee(100)).toBe(1);
    expect(tradeFee(1_000)).toBe(10);
    expect(tradeFee(0)).toBe(0);
  });

  it("includes the buy fee in the average cost", () => {
    expect(nextAverageCost(10, 50, 10, 700)).toBe(60);
    expect(nextAverageCost(0, 0, 10, 650)).toBe(65);
  });

  it("resolves stock seeds case-insensitively", () => {
    expect(stockSeed("delulu")?.symbol).toBe("DELULU");
    expect(stockSeed("nope")).toBeNull();
  });
});
