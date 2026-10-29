import type { ValkeyService } from "./valkey.js";
import type { Logger } from "../lib/logger.js";
import {
  FLEET_HEARTBEAT_INTERVAL_MS,
  FLEET_HEARTBEAT_TTL_SEC,
  fleetNodeKey,
  type FleetNodeRecord,
} from "@siela/shared";

export { FLEET_HEARTBEAT_INTERVAL_MS, FLEET_HEARTBEAT_TTL_SEC, fleetNodeKey };
export type { FleetNodeRecord };

/**
 * Ephemeral fleet session membership. Each node refreshes its own Valkey
 * key with a TTL; crashed nodes expire automatically and restarts
 * re-register on boot. No manual cleanup needed.
 */
export class FleetHeartbeat {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly valkey: ValkeyService | null,
    private readonly logger: Logger,
    private readonly nodeId: string,
    private readonly baseUrl: string,
    private readonly role: "commander" | "voice",
    private readonly getGuildIds: () => string[],
    private readonly intervalMs = FLEET_HEARTBEAT_INTERVAL_MS,
    private readonly ttlSec = FLEET_HEARTBEAT_TTL_SEC,
  ) {}

  start(): void {
    if (!this.valkey?.client || !this.baseUrl) return;
    void this.beat().catch((error) => this.logger.debug({ err: error }, "fleet heartbeat failed"));
    this.timer = setInterval(() => {
      void this.beat().catch((error) => this.logger.debug({ err: error }, "fleet heartbeat failed"));
    }, this.intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const client = this.valkey?.client;
    if (!client) return;
    await client.del(fleetNodeKey(this.nodeId)).catch(() => undefined);
  }

  private async beat(): Promise<void> {
    const client = this.valkey?.client;
    if (!client) return;
    const guildIds = this.getGuildIds();
    const value: FleetNodeRecord = {
      nodeId: this.nodeId,
      baseUrl: this.baseUrl,
      guildId: guildIds[0] ?? null,
      guildIds,
      role: this.role,
      startedAt: new Date().toISOString(),
    };
    await client.set(fleetNodeKey(this.nodeId), JSON.stringify(value), "EX", this.ttlSec);
  }
}
