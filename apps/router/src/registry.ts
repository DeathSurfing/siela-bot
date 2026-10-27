import { RedisClient } from "bun";
import type { Logger } from "./logger.js";
import { FLEET_NODE_KEY_PREFIX, type FleetNodeRecord } from "@siela/shared";
import type { FleetNode } from "./nodes.js";

export interface RegistryStore {
  scanKeys(pattern: string): Promise<string[]>;
  mget(keys: string[]): Promise<Array<string | null>>;
}

export class BunRegistryStore implements RegistryStore {
  private client: RedisClient | null = null;

  constructor(
    private readonly url: string,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    try {
      const client = new RedisClient(this.url, {
        connectionTimeout: 5000,
        autoReconnect: true,
        maxRetries: 10,
        enableOfflineQueue: true,
      });
      await client.connect();
      await client.ping();
      this.client = client;
    } catch (error) {
      this.logger.warn({ err: error }, "fleet registry valkey unavailable; using static nodes");
      this.client = null;
    }
  }

  stop(): void {
    this.client?.close();
    this.client = null;
  }

  get connected(): boolean {
    return this.client !== null;
  }

  async scanKeys(pattern: string): Promise<string[]> {
    const client = this.client;
    if (!client) return [];
    const found: string[] = [];
    let cursor = "0";
    do {
      const raw = (await client.send("SCAN", [cursor, "MATCH", pattern, "COUNT", "100"])) as unknown;
      const [next, keys] = Array.isArray(raw) ? (raw as [unknown, unknown]) : ["0", []];
      cursor = String(next ?? "0");
      if (Array.isArray(keys)) for (const key of keys) found.push(String(key));
    } while (cursor !== "0");
    return found;
  }

  async mget(keys: string[]): Promise<Array<string | null>> {
    const client = this.client;
    if (!client || keys.length === 0) return [];
    const raw = (await client.send("MGET", keys)) as unknown;
    if (!Array.isArray(raw)) return keys.map(() => null);
    return raw.map((value) => (typeof value === "string" ? value : null));
  }
}

function parseRecord(raw: string): FleetNode | null {
  try {
    const record = JSON.parse(raw) as Partial<FleetNodeRecord>;
    if (typeof record.nodeId === "string" && typeof record.baseUrl === "string" && record.baseUrl) {
      return { id: record.nodeId, baseUrl: record.baseUrl };
    }
  } catch {
    // ignore corrupt entries; TTL clears them
  }
  return null;
}

/**
 * Live fleet session. Static NODES are the fallback; Valkey heartbeats are
 * the source of truth when reachable. Keys carry a TTL, so crashed nodes
 * expire out and restarts re-register with no manual cleanup.
 */
export class FleetRegistry {
  constructor(
    private readonly store: RegistryStore | null,
    private readonly staticNodes: FleetNode[],
  ) {}

  /**
   * Guild-scoped session membership. With a guildId, only live heartbeats
   * bound to that guild count — semaphore capacity scales with the workers
   * actually serving the guild (1 for a lone commander). Static NODES are
   * the fallback when Valkey is unreachable, never an addition to live
   * state, so dead entries can't inflate the semaphore.
   */
  async list(guildId?: string | null): Promise<FleetNode[]> {
    if (this.store && guildId) {
      try {
        return await this.liveForGuild(guildId);
      } catch {
        // fall through to static nodes
      }
    }
    const byId = new Map<string, FleetNode>();
    for (const node of this.staticNodes) byId.set(node.id, node);
    if (this.store) {
      try {
        const keys = await this.store.scanKeys(`${FLEET_NODE_KEY_PREFIX}*`);
        const values = await this.store.mget(keys);
        for (const raw of values) {
          if (!raw) continue;
          const node = parseRecord(raw);
          if (node) byId.set(node.id, node);
        }
      } catch {
        // fall back to static nodes
      }
    }
    return [...byId.values()];
  }

  private async liveForGuild(guildId: string): Promise<FleetNode[]> {
    const store = this.store!;
    const keys = await store.scanKeys(`${FLEET_NODE_KEY_PREFIX}*`);
    const values = await store.mget(keys);
    const nodes: FleetNode[] = [];
    for (const raw of values) {
      if (!raw) continue;
      try {
        const record = JSON.parse(raw) as Partial<FleetNodeRecord>;
        if (record.guildId !== guildId) continue;
        const node = parseRecord(raw);
        if (node) nodes.push(node);
      } catch {
        // ignore corrupt entries; TTL clears them
      }
    }
    return nodes;
  }
}
