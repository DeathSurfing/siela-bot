import { describe, expect, it } from "vitest";
import { planDeploy } from "./plan.js";

describe("planDeploy", () => {
  it("skips rebuilds for docs-only changes", () => {
    expect(planDeploy(["docs/RUNBOOK.md", "README.md", "LICENSE"])).toBe("none");
  });

  it("uses the fast path when every change is bot source", () => {
    expect(
      planDeploy(["apps/bot/src/index.ts", "apps/bot/src/features/music.ts"]),
    ).toBe("fast");
  });

  it("falls back to a full build for mixed changes", () => {
    expect(planDeploy(["apps/bot/src/index.ts", "docs/RUNBOOK.md"])).toBe("full");
  });

  it("rebuilds for dependency and schema changes", () => {
    expect(planDeploy(["bun.lock"])).toBe("full");
    expect(planDeploy(["apps/bot/package.json"])).toBe("full");
    expect(planDeploy(["packages/db/drizzle/0001_new.sql"])).toBe("full");
  });

  it("rebuilds for bot assets", () => {
    expect(planDeploy(["apps/bot/assets/events/azan.ogg"])).toBe("full");
  });

  it("treats an empty diff as no work", () => {
    expect(planDeploy([])).toBe("none");
  });
});
