/**
 * Files whose change means the watchtower image no longer matches the
 * checkout. A stale deployer can recreate its own container and abort the
 * deploy midway, leaving the stack half-recreated.
 */
export function isDeployerInput(file: string): boolean {
  const normalized = file.replace(/\\/g, "/");
  return (
    normalized.startsWith("apps/watchtower/") ||
    normalized.startsWith("packages/config/") ||
    normalized.startsWith("packages/shared/") ||
    normalized === "package.json" ||
    normalized === "bun.lock" ||
    normalized === "tsconfig.base.json" ||
    normalized === "deploy/podman/Containerfile.watchtower"
  );
}

export function deployerDriftFiles(changedFiles: string[]): string[] {
  return changedFiles.filter(isDeployerInput);
}
