import { loadWatchtowerConfig } from "@siela/config";
import { createLogger } from "./logger.js";
import {
  changedFiles,
  currentBranch,
  fastForward,
  fetchBranch,
  isClean,
  localHead,
  remoteHead,
  resetHard,
} from "./git.js";
import { waitForCi } from "./ci.js";
import { planDeploy } from "./plan.js";
import { runDeploy, type DeployDeps } from "./deploy.js";
import { waitForBotHealthy } from "./health.js";
import { notify } from "./notify.js";
import { startStatusServer } from "./server.js";
import { loadState, saveState, type WatchtowerState } from "./state.js";
import { sleep } from "./run.js";

function nowIso(): string {
  return new Date().toISOString();
}

function short(sha: string | null): string {
  return sha ? sha.slice(0, 7) : "unknown";
}

async function main(): Promise<void> {
  const config = loadWatchtowerConfig();
  process.env.TZ = config.TZ;

  const logger = createLogger(config.LOG_LEVEL);
  const repoDir = config.WATCHTOWER_REPO_DIR;
  const state = await loadState(config.WATCHTOWER_STATE_DIR);

  const remote = {
    repoDir,
    repoUrl: config.WATCHTOWER_REPO_URL,
    branch: config.WATCHTOWER_BRANCH,
    token: config.GH_TOKEN,
  };
  const deps: DeployDeps = { config, logger, repoDir };

  let running = false;
  let stopped = false;
  let pendingTick = false;

  const persist = (): Promise<void> => saveState(config.WATCHTOWER_STATE_DIR, state);
  const send = (content: string): Promise<void> =>
    notify(config.WATCHTOWER_NOTIFY_WEBHOOK_URL, logger, content);

  function block(sha: string, reason: string): void {
    state.blockedSha = sha;
    state.blockedReason = reason;
    state.lastError = reason;
  }

  async function rollback(previousSha: string, mode: "fast" | "full", reason: string) {
    logger.error(
      { from: short(state.lastDeployedSha), to: short(previousSha), reason },
      "rolling back",
    );
    try {
      await resetHard(repoDir, previousSha);
      const result = await runDeploy(mode, deps);
      if (!result.ok) {
        state.lastError = `rollback deploy failed: ${result.detail}`;
        await send(
          `🚨 watchtower rollback to ${short(previousSha)} failed: ${result.detail}\nManual action required.`,
        );
        await persist();
        return false;
      }

      const health = await waitForBotHealthy(config.WATCHTOWER_HEALTH_TIMEOUT_SEC, logger);
      if (!health.ok) {
        state.lastError = `rollback health gate failed: ${health.detail}`;
        await send(
          `🚨 watchtower rollback to ${short(previousSha)} is unhealthy: ${health.detail}\nManual action required.`,
        );
        await persist();
        return false;
      }

      state.lastDeployedSha = previousSha;
      state.lastMode = mode;
      await persist();
      logger.info({ sha: short(previousSha) }, "rollback complete");
      await send(`↩️ watchtower rolled back to ${short(previousSha)} (${mode})`);
      return true;
    } catch (error) {
      state.lastError = `rollback failed: ${(error as Error).message}`;
      await send(
        `🚨 watchtower rollback to ${short(previousSha)} failed: ${(error as Error).message}`,
      );
      await persist();
      return false;
    }
  }

  async function fail(
    targetSha: string,
    previousSha: string,
    mode: "fast" | "full",
    detail: string,
  ): Promise<void> {
    block(targetSha, detail);
    await persist();
    await send(
      `❌ watchtower deploy failed for ${short(targetSha)} (${mode}): ${detail}\nRolling back to ${short(previousSha)}.`,
    );
    await rollback(previousSha, mode, detail);
  }

  async function checkOnce(): Promise<void> {
    state.lastCheckAt = nowIso();
    const target = await remoteHead(remote);
    state.lastRemoteSha = target;
    const local = await localHead(repoDir);

    if (target === local) {
      if (state.lastDeployedSha !== local) {
        state.lastDeployedSha = local;
        state.lastError = null;
        logger.info({ sha: short(local) }, "adopted current checkout");
      }
      await persist();
      return;
    }

    if (state.blockedSha === target) {
      logger.warn(
        { sha: short(target), reason: state.blockedReason },
        "commit is blocked; waiting for a new commit or a forced trigger",
      );
      await persist();
      return;
    }

    const branch = await currentBranch(repoDir);
    if (branch !== config.WATCHTOWER_BRANCH) {
      throw new Error(`checkout is on ${branch}, expected ${config.WATCHTOWER_BRANCH}`);
    }
    if (!(await isClean(repoDir))) {
      throw new Error("checkout has tracked local changes; refusing to deploy");
    }

    logger.info({ from: short(local), to: short(target) }, "new commit detected");

    const ci = await waitForCi({
      repoUrl: config.WATCHTOWER_REPO_URL,
      sha: target,
      token: config.GH_TOKEN,
      gate: config.WATCHTOWER_CI_GATE,
      graceSec: config.WATCHTOWER_CI_GRACE_SEC,
      timeoutSec: config.WATCHTOWER_CI_TIMEOUT_SEC,
      logger,
    });

    if (ci.status === "failed") {
      block(target, ci.detail);
      await persist();
      logger.error({ sha: short(target), detail: ci.detail }, "CI gate blocked deploy");
      await send(`⛔ watchtower blocked ${short(target)}: ${ci.detail}`);
      return;
    }
    if (ci.status === "deferred") {
      logger.warn({ sha: short(target), detail: ci.detail }, "deploy deferred");
      await persist();
      return;
    }
    logger.info({ sha: short(target), detail: ci.detail }, "CI gate result");

    if (config.WATCHTOWER_DRY_RUN) {
      logger.info({ sha: short(target) }, "dry run: skipping pull and deploy");
      await persist();
      return;
    }

    await fetchBranch(remote);
    const files = await changedFiles(repoDir, local, target);
    const mode = planDeploy(files);
    await fastForward(repoDir);
    logger.info(
      { from: short(local), to: short(target), mode, files: files.length },
      "checkout updated",
    );

    if (mode === "none") {
      state.lastDeployedSha = target;
      state.lastDeployedAt = nowIso();
      state.lastMode = "none";
      state.lastError = null;
      await persist();
      logger.info("docs-only change; no rebuild required");
      return;
    }

    const deployStartedAt = Date.now();
    const result = await runDeploy(mode, deps);
    if (!result.ok) {
      await fail(target, local, mode, result.detail);
      return;
    }

    const health = await waitForBotHealthy(config.WATCHTOWER_HEALTH_TIMEOUT_SEC, logger);
    if (!health.ok) {
      await fail(target, local, mode, `health gate failed: ${health.detail}`);
      return;
    }

    const durationSec = Math.round((Date.now() - deployStartedAt) / 1000);
    state.lastDeployedSha = target;
    state.lastDeployedAt = nowIso();
    state.lastMode = mode;
    state.lastError = null;
    state.blockedSha = null;
    state.blockedReason = null;
    await persist();
    logger.info({ sha: short(target), mode, durationSec }, "deploy complete");
    await send(`✅ watchtower deployed ${short(target)} (${mode}, ${durationSec}s)`);
  }

  async function tick(force = false): Promise<void> {
    if (force) {
      state.blockedSha = null;
      state.blockedReason = null;
      await persist();
    }
    if (running || stopped) {
      if (force) pendingTick = true;
      return;
    }
    running = true;
    try {
      await checkOnce();
    } catch (error) {
      const message = (error as Error).message;
      state.lastError = message;
      await persist().catch(() => undefined);
      logger.error({ err: error }, "watchtower check failed");
    } finally {
      running = false;
      if (pendingTick && !stopped) {
        pendingTick = false;
        void tick();
      }
    }
  }

  const server = startStatusServer({
    config,
    logger,
    state: () => state,
    repoDir,
    isBusy: () => running,
    trigger: (force) => {
      void tick(force);
    },
  });

  logger.info(
    {
      repoUrl: config.WATCHTOWER_REPO_URL,
      branch: config.WATCHTOWER_BRANCH,
      repoDir,
      intervalSec: config.WATCHTOWER_INTERVAL_SEC,
      ciGate: config.WATCHTOWER_CI_GATE,
      dryRun: config.WATCHTOWER_DRY_RUN,
      lastDeployedSha: state.lastDeployedSha,
    },
    "watchtower started",
  );

  const shutdown = async (signal: string): Promise<void> => {
    if (stopped) return;
    stopped = true;
    logger.info({ signal }, "shutting down");
    server.stop();
    for (let i = 0; i < 20 && running; i += 1) {
      await sleep(500);
    }
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  await tick();
  while (!stopped) {
    await sleep(config.WATCHTOWER_INTERVAL_SEC * 1000);
    await tick();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
