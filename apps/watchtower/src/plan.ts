/**
 * Decide what a push requires.
 *
 * - `none`: docs-only change. Pull, but do not rebuild or restart anything.
 * - `fast`: every change is bot source, so rebuild `apps/bot/dist` and restart
 *   the bot against the existing image. New dependencies always force `full`.
 * - `full`: rebuild images (and run migrations when enabled).
 */
export type DeployMode = "none" | "fast" | "full";

function isDocsOnly(file: string): boolean {
  if (file.startsWith("docs/")) return true;
  if (file === "LICENSE") return true;
  return /^[^/]+\.md$/i.test(file);
}

function isBotSource(file: string): boolean {
  return file.startsWith("apps/bot/src/");
}

export function planDeploy(changedFiles: string[]): DeployMode {
  const files = changedFiles.map((file) => file.replace(/\\/g, "/")).filter(Boolean);
  if (files.length === 0) return "none";
  if (files.every(isDocsOnly)) return "none";
  if (files.every(isBotSource)) return "fast";
  return "full";
}
