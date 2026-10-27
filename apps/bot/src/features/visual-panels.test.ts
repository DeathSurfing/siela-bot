vi.mock("@siela/db", () => ({ friendshipLevels: {} }));
import { describe, it, expect, vi } from "vitest";
import { renderBlackjackTable, blackjackHandTotal } from "./blackjack-table.js";
import { friendshipBoardPayload } from "./friendship-board.js";

describe("visual game and leaderboard panels", () => {
  it("does not reveal the dealer hole card through the image", () => {
    const game = { player: ["K♠", "7♥"], dealer: ["8♦", "A♠"], bet: 100, status: "playing" as const };
    expect(renderBlackjackTable(game)).toEqual(renderBlackjackTable({ ...game, dealer: ["8♦", "2♣"] }));
    expect(renderBlackjackTable({ ...game, status: "finished" })).not.toEqual(renderBlackjackTable(game));
  });
  it("counts aces correctly and renders long hands without failing", () => {
    expect(blackjackHandTotal(["A♠", "A♥", "9♣"])).toBe(21);
    expect(blackjackHandTotal(["K♠", "Q♥", "2♣"])).toBe(22);
    expect(renderBlackjackTable({ player: Array(12).fill("2♣"), dealer: ["K♠", "Q♥"], bet: 100, status: "finished", result: "You bust." }).subarray(1, 4).toString()).toBe("PNG");
  });
  it("preserves leaderboard page controls and readable alternative text", () => {
    const rows = Array.from({ length: 9 }, (_, index) => ({ userA: "a", userB: "b", xp: 9 - index }));
    const names = new Map([["a", "Alice"], ["b", "Bob"]]);
    const first = friendshipBoardPayload(rows, names, 1);
    const last = friendshipBoardPayload(rows, names, 2, true);
    const text = JSON.stringify(first.components);
    expect(text).toContain("Alice & Bob: 9 XP");
    expect(text).toContain("lb:page:2");
    expect(JSON.stringify(last.components)).toContain('"disabled":true');
    expect(last.attachments).toEqual([]);
    expect(first.files).toHaveLength(1);
  });
});

