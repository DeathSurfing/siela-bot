import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ENV_KEY = /^[A-Z0-9_]+$/;

/** Read a single flag from an env file without loading the rest into the process. */
export function readEnvFlag(path: string, key: string): boolean {
  if (!ENV_KEY.test(key)) return false;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  const line = text
    .split(/\r?\n/)
    .reverse()
    .find((entry) => entry.startsWith(`${key}=`));
  if (!line) return false;
  const value = line.slice(key.length + 1).replace(/^["']|["']$/g, "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export async function lockHash(lockfile: string): Promise<string> {
  const contents = await readFile(lockfile);
  return createHash("sha256").update(contents).digest("hex");
}

/**
 * Keep the shared node_modules volume in sync with the lockfile. Full deploys
 * refresh it too, so a later fast deploy builds with current dependencies.
 */
export async function ensureNodeModules(
  repoDir: string,
  runInstall: () => Promise<void>,
  logger: { info: (obj: unknown, msg: string) => void },
): Promise<void> {
  const modulesDir = join(repoDir, "node_modules");
  const marker = join(modulesDir, ".watchtower-lock");
  const current = await lockHash(join(repoDir, "bun.lock"));

  try {
    const previous = (await readFile(marker, "utf8")).trim();
    if (previous === current) return;
  } catch {
    // No marker yet; install below.
  }

  logger.info({ marker: current.slice(0, 12) }, "installing workspace dependencies");
  await runInstall();
  await mkdir(modulesDir, { recursive: true });
  await writeFile(marker, `${current}\n`, { mode: 0o644 });
}
