import { describe, expect, it, vi } from "vitest";
import {
  COINFLIP_WIN_CHANCE,
  MAX_CASINO_BET,
  playCoinflip,
  playSlots,
  rollCoinflip,
  rollSlots,
} from "./casino.js";

function economyWith(initial = 5_000) {
  const balance = { value: initial };
  const charges = new Map<string, number>();
  const awards = new Map<string, number>();
  const economy = {
    spend: vi.fn(async (_guildId: string, _userId: string, amount: number, _kind: string, key?: string) => {
      if (key && charges.has(key)) return;
      if (balance.value < amount) throw new Error("INSUFFICIENT_FUNDS");
      balance.value -= amount;
      if (key) charges.set(key, amount);
    }),
    award: vi.fn(async (_guildId: string, _userId: string, amount: number, _kind: string, key?: string) => {
      if (key && awards.has(key)) return { amount: 0, duplicate: true };
      balance.value += amount;
      if (key) awards.set(key, amount);
      return { amount, duplicate: false };
    }),
    getBalance: vi.fn(async () => ({ balance: balance.value })),
  };
  return { economy, charges, awards, balance };
}

function findRequest(predicate: (requestId: string) => boolean): string {
  for (let index = 0; index < 500; index += 1) {
    const requestId = `request-${index}`;
    if (predicate(requestId)) return requestId;
  }
  throw new Error("No request matched");
}

describe("casino", () => {
  it("uses a 48 percent coinflip win chance", () => {
    const wins = Array.from({ length: 2_000 }, (_, index) =>
      rollCoinflip("guild", "user", "heads", `request-${index}`).win,
    ).filter(Boolean).length;
    expect(wins / 2_000).toBeGreaterThan(COINFLIP_WIN_CHANCE - 0.05);
    expect(wins / 2_000).toBeLessThan(COINFLIP_WIN_CHANCE + 0.05);
  });

  it("charges once and replays the same coinflip outcome for a repeated request", async () => {
    const { economy, charges, awards } = economyWith(5_000);
    const requestId = findRequest((id) => rollCoinflip("guild", "user", "heads", id).win);

    const first = await playCoinflip(economy, "guild", "user", 100, "heads", requestId);
    const second = await playCoinflip(economy, "guild", "user", 100, "heads", requestId);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ side: "heads", result: "heads", win: true, bet: 100, payout: 200, balance: 5_100 });
    expect(charges.size).toBe(1);
    expect([...charges.values()]).toEqual([100]);
    expect(awards.size).toBe(1);
    expect(economy.spend).toHaveBeenCalledWith("guild", "user", 100, "coinflip", `casino:user:coinflip:${requestId}:spend`);
    expect(economy.award).toHaveBeenCalledWith("guild", "user", 200, "coinflip_win", `casino:user:coinflip:${requestId}:payout`);
  });

  it("takes a losing coinflip bet without a payout", async () => {
    const { economy, awards, balance } = economyWith(1_000);
    const requestId = findRequest((id) => !rollCoinflip("guild", "user", "heads", id).win);

    const result = await playCoinflip(economy, "guild", "user", 250, "heads", requestId);

    expect(result).toMatchObject({ result: "tails", win: false, payout: 0, balance: 750 });
    expect(awards.size).toBe(0);
    expect(balance.value).toBe(750);
  });

  it("pays five times the bet for three of a kind", async () => {
    const { economy } = economyWith(10_000);
    const requestId = findRequest((id) => rollSlots("guild", "user", id).multiplier === 5);

    const result = await playSlots(economy, "guild", "user", 200, requestId);

    expect(result.reels[0]).toBe(result.reels[1]);
    expect(result.reels[1]).toBe(result.reels[2]);
    expect(result).toMatchObject({ multiplier: 5, payout: 1_000, balance: 10_800 });
  });

  it("pays 1.6 times the bet for a pair and floors the payout", async () => {
    const { economy } = economyWith(1_000);
    const requestId = findRequest((id) => rollSlots("guild", "user", id).multiplier === 1.6);

    const result = await playSlots(economy, "guild", "user", 5, requestId);

    expect(result.multiplier).toBe(1.6);
    expect(result.payout).toBe(8);
    expect(Number.isInteger(result.payout)).toBe(true);
  });

  it("rejects a missing, fractional, negative, or oversized bet before charging", async () => {
    const { economy } = economyWith(20_000);

    await expect(playCoinflip(economy, "guild", "user", 0, "heads", "request-zero")).rejects.toThrow("whole number");
    await expect(playCoinflip(economy, "guild", "user", 1.5, "heads", "request-half")).rejects.toThrow("whole number");
    await expect(playSlots(economy, "guild", "user", -10, "request-neg")).rejects.toThrow("whole number");
    await expect(playSlots(economy, "guild", "user", MAX_CASINO_BET + 1, "request-big")).rejects.toThrow("maximum bet");
    expect(economy.spend).not.toHaveBeenCalled();
  });

  it("reports insufficient funds", async () => {
    const { economy } = economyWith(10);
    await expect(playCoinflip(economy, "guild", "user", 50, "heads", "request-broke")).rejects.toThrow(
      "You do not have enough coins.",
    );
  });
});
