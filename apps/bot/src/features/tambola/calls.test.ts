import { describe, expect, it } from "vitest";
import { BINGO_CALLS, GENERIC_FLAVOURS, buildCallPhrase } from "./calls.js";

describe("Tambola call phrases", () => {
  it("uses the classic call for every number", () => {
    for (let number = 1; number <= 90; number += 1) {
      const phrase = buildCallPhrase(number);
      expect(phrase.text).toContain(`Number ${number}.`);
      expect(phrase.text).toContain(BINGO_CALLS[number]!);
    }
  });

  it("avoids repeating the same generic flavour twice", () => {
    const last = 0;
    const phrase = buildCallPhrase(100, last, () => 0);
    expect(phrase.genericIndex).toBe(1 % GENERIC_FLAVOURS.length);
    expect(phrase.text).toContain(GENERIC_FLAVOURS[1]!);
  });
});
