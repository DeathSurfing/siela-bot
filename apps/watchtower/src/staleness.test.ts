import { describe, expect, it } from "vitest";
import { deployerDriftFiles, isDeployerInput } from "./staleness.js";

describe("isDeployerInput", () => {
  it("treats watchtower sources and its workspace deps as deployer inputs", () => {
    expect(isDeployerInput("apps/watchtower/src/deploy.ts")).toBe(true);
    expect(isDeployerInput("packages/config/src/index.ts")).toBe(true);
    expect(isDeployerInput("packages/shared/src/fleet.ts")).toBe(true);
    expect(isDeployerInput("package.json")).toBe(true);
    expect(isDeployerInput("bun.lock")).toBe(true);
    expect(isDeployerInput("deploy/podman/Containerfile.watchtower")).toBe(true);
  });

  it("ignores ordinary bot, router, and docs changes", () => {
    expect(isDeployerInput("apps/bot/src/bot.ts")).toBe(false);
    expect(isDeployerInput("apps/router/src/server.ts")).toBe(false);
    expect(isDeployerInput("docs/VOICE-FLEET.md")).toBe(false);
    expect(isDeployerInput("deploy/podman/Containerfile.bot")).toBe(false);
  });

  it("normalizes windows separators", () => {
    expect(isDeployerInput("apps\\watchtower\\src\\index.ts")).toBe(true);
  });
});

describe("deployerDriftFiles", () => {
  it("returns only the deployer files from a mixed diff", () => {
    expect(
      deployerDriftFiles([
        "apps/bot/src/bot.ts",
        "apps/watchtower/src/deploy.ts",
        "README.md",
        "bun.lock",
      ]),
    ).toEqual(["apps/watchtower/src/deploy.ts", "bun.lock"]);
  });

  it("returns nothing for a docs-only push", () => {
    expect(deployerDriftFiles(["docs/VOICE-FLEET.md", "README.md"])).toEqual([]);
  });
});
