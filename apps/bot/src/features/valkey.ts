import { RedisClient } from "bun";
import type { Logger } from "../lib/logger.js";

export class ValkeyService {
  private connection: RedisClient | null;

  constructor(url: string | null, private readonly logger: Logger) {
    this.connection = url
      ? new RedisClient(url, {
          connectionTimeout: 5000,
          autoReconnect: true,
          maxRetries: 10,
          enableOfflineQueue: true,
          enableAutoPipelining: true,
        })
      : null;
  }

  get client(): RedisClient | null {
    return this.connection;
  }

  async start(): Promise<void> {
    if (!this.connection) return;
    try {
      await this.connection.connect();
      await this.connection.ping();
      this.logger.info("valkey connected");
    } catch (error) {
      this.logger.warn({ err: error }, "valkey unavailable; friendship writes will use the database");
      this.connection.close();
      this.connection = null;
    }
  }

  async stop(): Promise<void> {
    if (!this.connection) return;
    this.connection.close();
    this.connection = null;
  }
}
