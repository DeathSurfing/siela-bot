import type { FleetNode } from "./nodes.js";

export interface NodePlaybackState {
  playing: boolean;
  hasCurrent: boolean;
  reachable: boolean;
  /** Voice channel the node is connected to, if any. */
  channelId?: string | null;
  /** Sticky TTS session on the node, if any. */
  tts?: { enabled: boolean; channelId?: string | null } | null;
}

export type FetchNodeState = (node: FleetNode) => Promise<NodePlaybackState>;

export class AllNodesBusyError extends Error {
  readonly statusCode = 429;
  readonly code = "all_nodes_busy";

  constructor(readonly fleetSize: number) {
    super(
      `All ${fleetSize} voice node(s) are busy. Add more worker nodes for more concurrent streams.`,
    );
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
    private readonly listNodes: (guildId?: string | null) => Promise<FleetNode[]>,
    private readonly fetchState: FetchNodeState,
  ) {}

  reservedCount(): number {
    return this.reserved.size;
  }

  private isBusy(node: FleetNode, state: NodePlaybackState, voiceChannelId?: string): boolean {
    if (state.playing || state.hasCurrent) return true;
    // A TTS session owns the voice connection. Music may share it only when
    // the node mixes and already speaks in the requested channel; anywhere
    // else a play would move the bot and cut the speech off.
    if (!state.tts?.enabled) return false;
    if (!node.ttsMix || !voiceChannelId) return true;
    return state.tts.channelId !== voiceChannelId;
  }

  async acquire(guildId?: string | null, voiceChannelId?: string): Promise<FleetNode> {
    const nodes = await this.listNodes(guildId);
    if (nodes.length === 0) throw new NoNodesReachableError();
    const settled = await Promise.allSettled(nodes.map(async (node) => ({ node, state: await this.fetchState(node) })));
    let anyReachable = false;
    for (const entry of settled) {
      if (entry.status !== "fulfilled") continue;
      anyReachable = true;
      const { node, state } = entry.value;
      if (this.reserved.has(node.id)) continue;
      if (this.isBusy(node, state, voiceChannelId)) continue;
      this.reserved.add(node.id);
      return node;
    }
    if (!anyReachable) throw new NoNodesReachableError();
    throw new AllNodesBusyError(nodes.length);
  }

  release(nodeId: string): void {
    this.reserved.delete(nodeId);
  }

  releaseAll(): void {
    this.reserved.clear();
  }
}
