import { createHash } from "node:crypto";
import { MAX_CASINO_BET } from "@siela/shared";
import { UserError } from "../lib/errors.js";

export { MAX_CASINO_BET };

export type CoinSide = "heads" | "tails";
export type CasinoGame = "coinflip" | "slots";

export const CASINO_SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "7️⃣"] as const;
export const COINFLIP_WIN_CHANCE = 0.48;

export interface CasinoEconomy {
  spend(guildId: string, userId: string, amount: number, kind: string, idempotencyKey?: string): Promise<void>;
  award(guildId: string, userId: string, amount: number, kind: string, idempotencyKey?: string): Promise<unknown>;
  getBalance(guildId: string, userId: string): Promise<{ balance: number }>;
}

export interface CoinflipOutcome {
  game: "coinflip";
  side: CoinSide;
  result: CoinSide;
  win: boolean;
  bet: number;
  payout: number;
  balance: number;
}

export interface SlotsOutcome {
  game: "slots";
  reels: string[];
  multiplier: number;
  bet: number;
  payout: number;
  balance: number;
}

export type CasinoOutcome = CoinflipOutcome | SlotsOutcome;

interface Roll {
  digest: Buffer;
}

function roll(guildId: string, userId: string, game: CasinoGame, requestId: string): Roll {
  return {
    digest: createHash("sha256").update(`${guildId}:${userId}:${game}:${requestId}`).digest(),
  };
}

function fraction(digest: Buffer, offset: number): number {
  return digest.readUInt32BE(offset) / 0x1_0000_0000;
}

export function rollCoinflip(guildId: string, userId: string, side: CoinSide, requestId: string): Pick<CoinflipOutcome, "result" | "win"> {
  const win = fraction(roll(guildId, userId, "coinflip", requestId).digest, 0) < COINFLIP_WIN_CHANCE;
  return { win, result: win ? side : side === "heads" ? "tails" : "heads" };
}

export function rollSlots(guildId: string, userId: string, requestId: string): Pick<SlotsOutcome, "reels" | "multiplier"> {
  const { digest } = roll(guildId, userId, "slots", requestId);
  const reels = [0, 4, 8].map((offset) => CASINO_SYMBOLS[Math.floor(fraction(digest, offset) * CASINO_SYMBOLS.length)]!);
  const [first, second, third] = reels;
  const multiplier = first === second && second === third ? 5 : first === second || second === third || first === third ? 1.6 : 0;
  return { reels, multiplier };
}

function assertBet(bet: number): void {
  if (!Number.isInteger(bet) || bet <= 0) throw new UserError("Bet must be a whole number of coins.");
  if (bet > MAX_CASINO_BET) throw new UserError(`The maximum bet is ${MAX_CASINO_BET.toLocaleString()} SC.`);
}

function paymentError(error: unknown): UserError {
  const message = error instanceof Error ? error.message : "Bet failed.";
  if (message === "INSUFFICIENT_FUNDS") return new UserError("You do not have enough coins.");
  return new UserError(message);
}

function keys(userId: string, game: CasinoGame, requestId: string): { spend: string; payout: string } {
  return {
    spend: `casino:${userId}:${game}:${requestId}:spend`,
    payout: `casino:${userId}:${game}:${requestId}:payout`,
  };
}

export async function playCoinflip(
  economy: CasinoEconomy,
  guildId: string,
  userId: string,
  bet: number,
  side: CoinSide,
  requestId: string,
): Promise<CoinflipOutcome> {
  assertBet(bet);
  const key = keys(userId, "coinflip", requestId);
  try {
    await economy.spend(guildId, userId, bet, "coinflip", key.spend);
  } catch (error) {
    throw paymentError(error);
  }
  const outcome = rollCoinflip(guildId, userId, side, requestId);
  const payout = outcome.win ? bet * 2 : 0;
  if (payout > 0) await economy.award(guildId, userId, payout, "coinflip_win", key.payout);
  const { balance } = await economy.getBalance(guildId, userId);
  return { game: "coinflip", side, result: outcome.result, win: outcome.win, bet, payout, balance };
}

export async function playSlots(
  economy: CasinoEconomy,
  guildId: string,
  userId: string,
  bet: number,
  requestId: string,
): Promise<SlotsOutcome> {
  assertBet(bet);
  const key = keys(userId, "slots", requestId);
  try {
    await economy.spend(guildId, userId, bet, "slots", key.spend);
  } catch (error) {
    throw paymentError(error);
  }
  const outcome = rollSlots(guildId, userId, requestId);
  const payout = Math.floor(bet * outcome.multiplier);
  if (payout > 0) await economy.award(guildId, userId, payout, "slots_win", key.payout);
  const { balance } = await economy.getBalance(guildId, userId);
  return { game: "slots", reels: outcome.reels, multiplier: outcome.multiplier, bet, payout, balance };
}
