import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DeployMode } from "./plan.js";

export interface WatchtowerState {
  version: 1;
  lastDeployedSha: string | null;
  lastDeployedAt: string | null;
  lastMode: DeployMode | null;
  blockedSha: string | null;
  blockedReason: string | null;
  lastError: string | null;
  lastCheckAt: string | null;
  lastRemoteSha: string | null;
}

export function emptyState(): WatchtowerState {
  return {
    version: 1,
    lastDeployedSha: null,
    lastDeployedAt: null,
    lastMode: null,
    blockedSha: null,
    blockedReason: null,
    lastError: null,
    lastCheckAt: null,
    lastRemoteSha: null,
  };
}

function statePath(stateDir: string): string {
  return join(stateDir, "watchtower.json");
}

export async function loadState(stateDir: string): Promise<WatchtowerState> {
  await mkdir(stateDir, { recursive: true });
  try {
    const raw = await readFile(statePath(stateDir), "utf8");
    const parsed = JSON.parse(raw) as Partial<WatchtowerState>;
    return { ...emptyState(), ...parsed, version: 1 };
  } catch {
    return emptyState();
  }
}

export async function saveState(stateDir: string, state: WatchtowerState): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  const target = statePath(stateDir);
  const temp = `${target}.tmp`;
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, target);
}
