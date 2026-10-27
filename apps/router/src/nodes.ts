export interface FleetNode {
  id: string;
  baseUrl: string;
  /** Node can play TTS over music on the same voice connection. */
  ttsMix?: boolean;
}

export function parseNodes(raw: string | undefined): FleetNode[] {
  if (!raw) return [];
  const nodes: FleetNode[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) throw new Error(`Invalid NODES entry: ${trimmed}. Expected id=url.`);
    const id = trimmed.slice(0, eq).trim();
    const baseUrl = trimmed.slice(eq + 1).trim().replace(/\/+$/, "");
    if (!id || !baseUrl) throw new Error(`Invalid NODES entry: ${trimmed}. Expected id=url.`);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error(`Invalid node ID: ${id}.`);
    if (!/^https?:\/\//.test(baseUrl)) throw new Error(`Invalid node URL: ${trimmed}.`);
    nodes.push({ id, baseUrl });
  }
  const ids = nodes.map((node) => node.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate node IDs in NODES.");
  return nodes;
}

/** Music ops the router fans out, mapped to worker paths. */
export const MUSIC_OPS = new Set([
  "join",
  "play",
  "pause",
  "resume",
  "skip",
  "stop",
  "volume",
  "seek",
  "loop",
  "shuffle",
  "remove",
  "clear",
  "move",
  "jump",
  "autoplay",
  "filters",
  "disconnect",
]);

export function workerPath(op: string): string {
  return `/internal/music/${op}`;
}
