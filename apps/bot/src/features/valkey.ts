import Redis from "ioredis";
import type { Logger } from "../lib/logger.js";

export class ValkeyService {
  private connection: Redis | null;

  constructor(url: string | null, private readonly logger: Logger) {
    this.connection = url
      ? new Redis(url, {
          lazyConnect: true,
          maxRetriesPerRequest: 2,
          enableOfflineQueue: false,
          retryStrategy: (times) => (times > 5 ? null : Math.min(times * 250, 2_000)),
        })
      : null;
  }

  get client(): Redis | null {
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
      this.connection.disconnect();
      this.connection = null;
    }
  }

  async stop(): Promise<void> {
    if (!this.connection) return;
    await this.connection.quit().catch(() => undefined);
    this.connection = null;
  }
}
