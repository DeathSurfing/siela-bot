import { describe, expect, it } from "vitest";
import { loveBar, loveResult, loveScore } from "./love.js";

const GUILD = "1561548714823258172";
const A = "111111111111111111";
const B = "222222222222222222";

describe("love calculator", () => {
  it("is stable for the same pair regardless of order or invocation", () => {
    expect(loveScore(GUILD, A, B)).toBe(loveScore(GUILD, A, B));
    expect(loveScore(GUILD, A, B)).toBe(loveScore(GUILD, B, A));
    expect(loveResult(GUILD, A, B)).toEqual(loveResult(GUILD, B, A));
  });

  it("stays within the 0-100 range and has a full bar", () => {
    for (let index = 0; index < 25; index += 1) {
      const id = String(300000000000000000 + index);
      const score = loveScore(GUILD, A, id);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
    expect(loveBar(0)).toBe("🖤🖤🖤🖤🖤🖤🖤🖤🖤🖤");
    expect(loveBar(100)).toBe("❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️");
  });

  it("supports a future reroll nonce", () => {
    expect(loveScore(GUILD, A, B, 1)).not.toBe(loveScore(GUILD, A, B, 0));
  });
});
