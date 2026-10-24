import { failureDetail, runCommand } from "./run.js";

export interface GitRemote {
  repoDir: string;
  repoUrl: string;
  branch: string;
  token?: string;
}

function authEnv(repoUrl: string, token: string | undefined): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { GIT_TERMINAL_PROMPT: "0" };
  if (!token) return env;

  let origin: string;
  try {
    const url = new URL(repoUrl);
    if (url.protocol !== "https:") return env;
    origin = url.origin;
  } catch {
    return env;
  }

  // Keep the token out of argv. GitHub accepts basic auth for git over HTTPS.
  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  return {
    ...env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `http.${origin}/.extraheader`,
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  };
}

export async function remoteHead(remote: GitRemote): Promise<string> {
  const result = await runCommand(
    "git",
    ["ls-remote", remote.repoUrl, `refs/heads/${remote.branch}`],
    {
      cwd: remote.repoDir,
      env: authEnv(remote.repoUrl, remote.token),
      timeoutMs: 60_000,
    },
  );
  if (result.code !== 0) {
    throw new Error(`git ls-remote failed: ${failureDetail(result)}`);
  }
  const sha = (result.stdout.trim().split("\n")[0] ?? "").split(/\s+/)[0] ?? "";
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`could not resolve ${remote.branch} on ${remote.repoUrl}`);
  }
  return sha;
}

export async function localHead(repoDir: string): Promise<string> {
  const result = await runCommand("git", ["rev-parse", "HEAD"], { cwd: repoDir });
  if (result.code !== 0) throw new Error(`git rev-parse failed: ${failureDetail(result)}`);
  return result.stdout.trim();
}

export async function currentBranch(repoDir: string): Promise<string> {
  const result = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoDir,
  });
  if (result.code !== 0) throw new Error(`git rev-parse failed: ${failureDetail(result)}`);
  return result.stdout.trim();
}

/** Tracked changes only. Untracked files do not block a fast-forward. */
export async function isClean(repoDir: string): Promise<boolean> {
  const result = await runCommand(
    "git",
    ["status", "--porcelain", "--untracked-files=no"],
    { cwd: repoDir },
  );
  if (result.code !== 0) throw new Error(`git status failed: ${failureDetail(result)}`);
  return result.stdout.trim() === "";
}

export async function fetchBranch(remote: GitRemote): Promise<void> {
  const result = await runCommand(
    "git",
    ["fetch", "--no-tags", remote.repoUrl, `refs/heads/${remote.branch}`],
    {
      cwd: remote.repoDir,
      env: authEnv(remote.repoUrl, remote.token),
      timeoutMs: 300_000,
    },
  );
  if (result.code !== 0) {
    throw new Error(`git fetch failed: ${failureDetail(result)}`);
  }
}

export async function changedFiles(repoDir: string, from: string, to: string): Promise<string[]> {
  const result = await runCommand("git", ["diff", "--name-only", from, to], { cwd: repoDir });
  if (result.code !== 0) {
    throw new Error(`git diff failed: ${failureDetail(result)}`);
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function fastForward(repoDir: string): Promise<void> {
  const result = await runCommand("git", ["merge", "--ff-only", "FETCH_HEAD"], {
    cwd: repoDir,
  });
  if (result.code !== 0) {
    throw new Error(`git merge --ff-only failed: ${failureDetail(result)}`);
  }
}

export async function resetHard(repoDir: string, sha: string): Promise<void> {
  const result = await runCommand("git", ["reset", "--hard", sha], { cwd: repoDir });
  if (result.code !== 0) {
    throw new Error(`git reset --hard failed: ${failureDetail(result)}`);
  }
}
