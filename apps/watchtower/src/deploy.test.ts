import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { voiceWorkerServices } from "./deploy.js";

describe("voiceWorkerServices", () => {
  let dir = "";
  let repoDir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "siela-wt-"));
    repoDir = join(dir, "repo");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("finds generated voice services", async () => {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(repoDir, "deploy/podman"), { recursive: true });
    writeFileSync(
      join(repoDir, "deploy/podman/compose.voice.generated.yaml"),
      "services:\n  bot-voice-1:\n    image: x\n  bot-voice-2:\n    image: x\n  bot:\n    image: y\n",
    );
    expect(voiceWorkerServices(repoDir)).toEqual(["bot-voice-1", "bot-voice-2"]);
  });

  it("returns empty when no overlay exists", () => {
    expect(voiceWorkerServices(join(dir, "missing"))).toEqual([]);
  });
});
