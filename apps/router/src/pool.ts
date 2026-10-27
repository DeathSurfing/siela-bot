import type { FleetNode } from "./nodes.js";

export interface NodePlaybackState {
  playing: boolean;
  hasCurrent: boolean;
  reachable: boolean;
}

export type FetchNodeState = (node: FleetNode) => Promise<NodePlaybackState>;

export class AllNodesBusyError extends Error {
  readonly statusCode = 429;
  readonly code = "all_nodes_busy";

  constructor(readonly fleetSize: number) {
    super(`All ${fleetSize} voice node(s) are busy. Try again when one is free.`);
    this.name = "AllNodesBusyError";
  }
}

export class NoNodesReachableError extends Error {
  readonly statusCode = 502;
  readonly code = "no_nodes_reachable";

  constructor() {
    super("No voice nodes are reachable.");
    this.name = "NoNodesReachableError";
  }
}

/**
 * Fleet-wide admission control. A node counts as busy while it is playing
 * or holding a current track. Reservations close the race between
 * concurrent auto-route requests: a node is claimed synchronously after
 * states are read and released once the forwarded request settles.
 *
 * Single-router-process scope. Run one router replica per fleet.
 */
export class FleetPool {
  private readonly reserved = new Set<string>();

  constructor(
    private readonly nodes: FleetNode[],
    private readonly fetchState: FetchNodeState,
  ) {}

  size(): number {
    return this.nodes.length;
  }

  reservedCount(): number {
    return this.reserved.size;
  }

  private isBusy(state: NodePlaybackState): boolean {
    return state.playing || state.hasCurrent;
  }

  async acquire(): Promise<FleetNode> {
    if (this.nodes.length === 0) throw new NoNodesReachableError();
    const settled = await Promise.allSettled(this.nodes.map(async (node) => ({ node, state: await this.fetchState(node) })));
    let anyReachable = false;
    for (const entry of settled) {
      if (entry.status !== "fulfilled") continue;
      anyReachable = true;
      const { node, state } = entry.value;
      if (this.reserved.has(node.id)) continue;
      if (this.isBusy(state)) continue;
      this.reserved.add(node.id);
      return node;
    }
    if (!anyReachable) throw new NoNodesReachableError();
    throw new AllNodesBusyError(this.nodes.length);
  }

  release(nodeId: string): void {
    this.reserved.delete(nodeId);
  }
}
