import { describe, expect, it } from "vitest";
import { parseGitHubRepo } from "./ci.js";

describe("parseGitHubRepo", () => {
  it("parses https URLs with and without .git", () => {
    expect(
      parseGitHubRepo("https://github.com/DeathSurfing/siela-bot.git"),
    ).toEqual({ owner: "DeathSurfing", repo: "siela-bot" });
    expect(
      parseGitHubRepo("https://github.com/DeathSurfing/siela-bot"),
    ).toEqual({ owner: "DeathSurfing", repo: "siela-bot" });
  });

  it("parses ssh URLs", () => {
    expect(
      parseGitHubRepo("git@github.com:someuser/siela-fork.git"),
    ).toEqual({ owner: "someuser", repo: "siela-fork" });
  });

  it("rejects non-GitHub and incomplete URLs", () => {
    expect(parseGitHubRepo("https://gitlab.com/owner/repo.git")).toBeNull();
    expect(parseGitHubRepo("https://github.com/owner")).toBeNull();
    expect(parseGitHubRepo("not a url")).toBeNull();
  });
});
