/**
 * Fleet session contract shared by voice nodes (writers) and the router
 * (reader). Session membership lives only in Valkey: each node refreshes
 * its own key with a TTL, so crashed nodes expire and restarts re-register
 * with no manual cleanup.
 */

export const FLEET_NODE_KEY_PREFIX = "siela:fleet:node:";
export const FLEET_HEARTBEAT_TTL_SEC = 45;
export const FLEET_HEARTBEAT_INTERVAL_MS = 15_000;

export interface FleetNodeRecord {
  nodeId: string;
  baseUrl: string;
  guildId: string | null;
  role: "commander" | "voice";
  startedAt: string;
  /**
   * True when the node can mix TTS over music on one voice connection.
   * The Rust worker sets this; the TypeScript commander does not, because it
   * has to stop music to give TTS a voice connection.
   */
  ttsMix?: boolean;
}

export function fleetNodeKey(nodeId: string): string {
  return `${FLEET_NODE_KEY_PREFIX}${nodeId}`;
}
