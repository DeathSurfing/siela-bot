import type { Logger } from "./logger.js";
import { sleep } from "./run.js";

export type CiGate = "auto" | "required" | "off";

export type CiOutcome =
  | { status: "green"; detail: string }
  | { status: "failed"; detail: string }
  | { status: "skipped"; detail: string }
  | { status: "deferred"; detail: string };

export interface CiOptions {
  repoUrl: string;
  sha: string;
  token?: string;
  gate: CiGate;
  graceSec: number;
  timeoutSec: number;
  logger: Logger;
}

interface CheckRun {
  name?: string;
  status?: string;
  conclusion?: string | null;
}

interface CheckRunsResponse {
  total_count?: number;
  check_runs?: CheckRun[];
}

const FAILED_CONCLUSIONS = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "startup_failure",
  "stale",
]);

const PASSED_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

export function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  const trimmed = url.trim();
  const match =
    /^https?:\/\/github\.com\/(.+)$/i.exec(trimmed) ??
    /^git@github\.com:(.+)$/i.exec(trimmed) ??
    /^ssh:\/\/git@github\.com\/(.+)$/i.exec(trimmed);
  if (!match?.[1]) return null;

  const path = match[1].replace(/\.git$/i, "").replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!owner || !repo) return null;
  return { owner, repo };
}

interface ChecksResult {
  ok: boolean;
  detail: string;
  runs: CheckRun[];
}

async function fetchChecks(
  owner: string,
  repo: string,
  sha: string,
  token: string | undefined,
): Promise<ChecksResult> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "siela-watchtower",
    "x-github-api-version": "2022-11-28",
  };
  if (token) headers.authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`,
      { headers, signal: AbortSignal.timeout(15_000) },
    );
  } catch (error) {
    return { ok: false, detail: `GitHub API request failed: ${(error as Error).message}`, runs: [] };
  }

  if (response.status === 403 || response.status === 429) {
    return {
      ok: false,
      detail: `GitHub API rate limited (${response.status}); set GH_TOKEN or retry later`,
      runs: [],
    };
  }
  if (response.status === 404) {
    return {
      ok: false,
      detail: "repository or commit not found (private fork needs GH_TOKEN)",
      runs: [],
    };
  }
  if (!response.ok) {
    return { ok: false, detail: `GitHub API returned ${response.status}`, runs: [] };
  }

  let body: CheckRunsResponse;
  try {
    body = (await response.json()) as CheckRunsResponse;
  } catch {
    return { ok: false, detail: "GitHub API returned invalid JSON", runs: [] };
  }
  const runs = Array.isArray(body.check_runs) ? body.check_runs : [];
  return { ok: true, detail: `${body.total_count ?? runs.length} check run(s)`, runs };
}

export async function waitForCi(options: CiOptions): Promise<CiOutcome> {
  if (options.gate === "off") {
    return { status: "skipped", detail: "CI gate is off" };
  }

  const slug = parseGitHubRepo(options.repoUrl);
  if (!slug) {
    return { status: "skipped", detail: "not a GitHub repository; CI gate skipped" };
  }

  const startedAt = Date.now();
  const graceDeadline = startedAt + options.graceSec * 1000;
  const deadline = startedAt + options.timeoutSec * 1000;
  const shortSha = options.sha.slice(0, 7);

  let delayMs = 10_000;
  let sawRuns = false;
  let lastDetail = "";

  for (;;) {
    const checks = await fetchChecks(slug.owner, slug.repo, options.sha, options.token);
    if (!checks.ok) {
      return { status: "deferred", detail: checks.detail };
    }

    const runs = checks.runs;
    if (runs.length > 0) sawRuns = true;

    const failed = runs.filter(
      (run) => run.status === "completed" && FAILED_CONCLUSIONS.has(run.conclusion ?? ""),
    );
    if (failed.length > 0) {
      const names = failed.map((run) => run.name ?? "unnamed").join(", ");
      return { status: "failed", detail: `CI failed on ${shortSha}: ${names}` };
    }

    if (
      sawRuns &&
      runs.length > 0 &&
      runs.every(
        (run) =>
          run.status === "completed" && PASSED_CONCLUSIONS.has(run.conclusion ?? ""),
      )
    ) {
      return { status: "green", detail: `CI green on ${shortSha}` };
    }

    if (checks.detail !== lastDetail) {
      options.logger.info(
        { sha: shortSha, runs: runs.length, sawRuns },
        "waiting for CI",
      );
      lastDetail = checks.detail;
    }

    const now = Date.now();
    if (!sawRuns && options.gate === "auto" && now >= graceDeadline) {
      return {
        status: "skipped",
        detail: `no CI checks appeared for ${shortSha} within ${options.graceSec}s`,
      };
    }
    if (now >= deadline) {
      return {
        status: "deferred",
        detail: `CI still running on ${shortSha} after ${options.timeoutSec}s`,
      };
    }

    const remaining = deadline - now;
    await sleep(Math.min(delayMs, remaining));
    delayMs = Math.min(delayMs * 2, 60_000);
  }
}
