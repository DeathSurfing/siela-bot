import type { WatchtowerConfig } from "@siela/config";
import { join } from "node:path";
import { failureDetail, runCommand } from "./run.js";
import type { DeployMode } from "./plan.js";
import type { Logger } from "./logger.js";
import { ensureNodeModules } from "./workspace.js";

export interface DeployDeps {
  config: WatchtowerConfig;
  logger: Logger;
  repoDir: string;
  mcpEnabled: boolean;
}

export interface DeployResult {
  ok: boolean;
  detail: string;
}

const LONG_TIMEOUT = 30 * 60_000;
const SHORT_TIMEOUT = 10 * 60_000;

async function runWrapper(
  deps: DeployDeps,
  args: string[],
  timeoutMs: number,
): ReturnType<typeof runCommand> {
  const script = join(deps.repoDir, "scripts/podman-stack.sh");
  return runCommand("bash", [script, ...args], {
    cwd: deps.repoDir,
    env: {
      // Keep the watchtower service in the compose project. `podman compose
      // run` removes orphan containers, and this container is an orphan when
      // the overlay is omitted.
      WATCHTOWER_ENABLED: "true",
      MCP_ENABLED: deps.mcpEnabled ? "true" : "false",
    },
    timeoutMs,
  });
}

async function buildImage(
  deps: DeployDeps,
  dockerfile: string,
  tag: string,
): Promise<DeployResult> {
  const args = ["build"];
  if (deps.config.WATCHTOWER_BUILD_NETWORK) {
    args.push(`--network=${deps.config.WATCHTOWER_BUILD_NETWORK}`);
  }
  args.push("-f", join(deps.repoDir, dockerfile), "-t", tag, deps.repoDir);

  deps.logger.info({ tag, dockerfile }, "building image");
  const result = await runCommand("podman", args, {
    cwd: deps.repoDir,
    timeoutMs: LONG_TIMEOUT,
  });
  if (result.code !== 0) {
    return { ok: false, detail: `image build failed (${tag}): ${failureDetail(result)}` };
  }
  return { ok: true, detail: `built ${tag}` };
}

async function composeUp(
  deps: DeployDeps,
  services: string[],
  fastOverlay?: string,
): Promise<DeployResult> {
  const args: string[] = [];
  if (fastOverlay) args.push("-f", fastOverlay);
  args.push("up", "-d", "--force-recreate", ...services);

  deps.logger.info({ services, fast: Boolean(fastOverlay) }, "recreating services");
  const result = await runWrapper(deps, args, LONG_TIMEOUT);
  if (result.code !== 0) {
    return { ok: false, detail: `compose up failed: ${failureDetail(result)}` };
  }
  return { ok: true, detail: `recreated ${services.join(", ")}` };
}

async function deployFull(deps: DeployDeps): Promise<DeployResult> {
  const bot = await buildImage(
    deps,
    "deploy/podman/Containerfile.bot",
    "localhost/siela-bot:latest",
  );
  if (!bot.ok) return bot;

  if (deps.mcpEnabled) {
    const mcp = await buildImage(
      deps,
      "deploy/podman/Containerfile.mcp",
      "localhost/siela-mcp:latest",
    );
    if (!mcp.ok) return mcp;
  }

  if (deps.config.WATCHTOWER_RUN_MIGRATIONS) {
    const migrated = await runMigrations(deps);
    if (!migrated.ok) return migrated;
  }

  const services = deps.mcpEnabled ? ["bot", "mcp"] : ["bot"];
  return composeUp(deps, services);
}

/**
 * Run migrations with plain `podman run`.
 *
 * `podman compose run` starts dependencies with orphan removal, which tears
 * down containers that are not part of that compose invocation. Including the
 * watchtower overlay fixes the orphan, but the one-off container still adds
 * pod churn. This path only needs the data network and the env file.
 *
 * The network name follows `-p siela` in scripts/podman-stack.sh.
 */
async function runMigrations(deps: DeployDeps): Promise<DeployResult> {
  deps.logger.info("running database migrations");
  const result = await runCommand(
    "podman",
    [
      "run",
      "--rm",
      "--network",
      "siela_data",
      "--env-file",
      join(deps.repoDir, "deploy/podman/.env"),
      "localhost/siela-bot:latest",
      "node",
      "dist/scripts/migrate.js",
    ],
    { cwd: deps.repoDir, timeoutMs: SHORT_TIMEOUT },
  );
  if (result.code !== 0) {
    return { ok: false, detail: `migrations failed: ${failureDetail(result)}` };
  }
  return { ok: true, detail: "migrations complete" };
}

async function deployFast(deps: DeployDeps): Promise<DeployResult> {  await ensureNodeModules(
    deps.repoDir,
    async () => {
      const install = await runCommand("bun", ["install", "--frozen-lockfile"], {
        cwd: deps.repoDir,
        timeoutMs: SHORT_TIMEOUT,
      });
      if (install.code !== 0) {
        throw new Error(`bun install failed: ${failureDetail(install)}`);
      }
    },
    deps.logger,
  );

  deps.logger.info("building bot dist");
  const build = await runCommand("bun", ["run", "--cwd", "apps/bot", "build"], {
    cwd: deps.repoDir,
    timeoutMs: SHORT_TIMEOUT,
  });
  if (build.code !== 0) {
    return { ok: false, detail: `bot build failed: ${failureDetail(build)}` };
  }

  return composeUp(
    deps,
    ["bot"],
    join(deps.repoDir, "deploy/podman/compose.fast.yaml"),
  );
}

export async function runDeploy(
  mode: Exclude<DeployMode, "none">,
  deps: DeployDeps,
): Promise<DeployResult> {
  try {
    return mode === "full" ? await deployFull(deps) : await deployFast(deps);
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  }
}
