import { describe, expect, it } from "vitest";
import { selectGuildId } from "./server.js";

const served = ["111111111111111111", "222222222222222222"];

describe("selectGuildId", () => {
  it("uses an explicit guild that this node serves", () => {
    expect(selectGuildId({ explicit: "222222222222222222", served, fallback: null })).toBe("222222222222222222");
  });

  it("rejects a guild this node does not serve", () => {
    expect(() => selectGuildId({ explicit: "333333333333333333", served, fallback: null }))
      .toThrowError(/Unknown guild/);
  });

  it("refuses to guess when several guilds are served", () => {
    expect(() => selectGuildId({ explicit: null, served, fallback: null }))
      .toThrowError(/x-guild-id/);
  });

  it("falls back to the only guild when one is served", () => {
    expect(selectGuildId({ explicit: null, served: ["111111111111111111"], fallback: "111111111111111111" }))
      .toBe("111111111111111111");
  });

  it("prefers the configured guild as the fallback", () => {
    expect(selectGuildId({ explicit: null, served, fallback: "111111111111111111" })).toBe("111111111111111111");
  });

  it("reports not ready when no guild is served", () => {
    expect(() => selectGuildId({ explicit: null, served: [], fallback: null })).toThrowError(/not serving/);
  });
});
