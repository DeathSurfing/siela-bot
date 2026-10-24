import { createHash, timingSafeEqual } from "node:crypto";
import type { WatchtowerConfig } from "@siela/config";
import type { Logger } from "./logger.js";
import type { WatchtowerState } from "./state.js";
import { localHead } from "./git.js";

export interface StatusServerOptions {
  config: WatchtowerConfig;
  logger: Logger;
  state: () => WatchtowerState;
  repoDir: string;
  trigger: (force: boolean) => void;
}

export interface StatusServer {
  stop: () => void;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function authorized(request: Request, token: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header.slice(prefix.length)), digest(token));
}

function metrics(state: WatchtowerState): string {
  const lastDeploy = state.lastDeployedAt
    ? Math.floor(Date.parse(state.lastDeployedAt) / 1000)
    : 0;
  return [
    "# HELP watchtower_up Whether the watchtower process is serving.",
    "# TYPE watchtower_up gauge",
    "watchtower_up 1",
    "# HELP watchtower_blocked Whether the current remote commit is blocked.",
    "# TYPE watchtower_blocked gauge",
    `watchtower_blocked ${state.blockedSha ? 1 : 0}`,
    "# HELP watchtower_last_deploy_timestamp_seconds Unix time of the last deploy.",
    "# TYPE watchtower_last_deploy_timestamp_seconds gauge",
    `watchtower_last_deploy_timestamp_seconds ${Number.isFinite(lastDeploy) ? lastDeploy : 0}`,
    "",
  ].join("\n");
}

async function readForce(request: Request): Promise<boolean> {
  try {
    const body = (await request.json()) as { force?: unknown };
    return body?.force === true;
  } catch {
    return false;
  }
}

export function startStatusServer(options: StatusServerOptions): StatusServer {
  const { config, logger, state, repoDir, trigger } = options;

  const server = Bun.serve({
    hostname: config.WATCHTOWER_HTTP_HOST,
    port: config.WATCHTOWER_HTTP_PORT,
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === "/healthz") {
        return json({ ok: true });
      }

      if (url.pathname === "/metrics") {
        return new Response(metrics(state()), {
          headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
        });
      }

      if (url.pathname === "/status") {
        const head = await localHead(repoDir).catch(() => null);
        return json({
          repoUrl: config.WATCHTOWER_REPO_URL,
          branch: config.WATCHTOWER_BRANCH,
          repoDir,
          head,
          intervalSec: config.WATCHTOWER_INTERVAL_SEC,
          ciGate: config.WATCHTOWER_CI_GATE,
          dryRun: config.WATCHTOWER_DRY_RUN,
          state: state(),
        });
      }

      if (url.pathname === "/trigger") {
        if (request.method !== "POST") {
          return json({ error: "method not allowed" }, 405);
        }
        if (!authorized(request, config.WATCHTOWER_TOKEN)) {
          return json({ error: "unauthorized" }, 401);
        }
        const force = await readForce(request);
        trigger(force);
        return json({ accepted: true, force }, 202);
      }

      return json({ error: "not found" }, 404);
    },
  });

  logger.info(
    { host: config.WATCHTOWER_HTTP_HOST, port: config.WATCHTOWER_HTTP_PORT },
    "status server listening",
  );

  return {
    stop: () => server.stop(true),
  };
}
