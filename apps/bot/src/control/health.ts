import Fastify, { type FastifyInstance } from "fastify";
import { Counter, Registry, collectDefaultMetrics } from "prom-client";
import type { Logger } from "../lib/logger.js";

export interface HealthServerOptions {
  host: string;
  port: number;
  logger: Logger;
  isReady: () => Promise<{ ready: boolean; details: Record<string, unknown> }>;
}

export class HealthServer {
  private readonly app: FastifyInstance;
  private readonly registry = new Registry();

  constructor(private readonly options: HealthServerOptions) {
    this.registry.setDefaultLabels({ app: "siela-bot" });
    collectDefaultMetrics({ register: this.registry });
    this.app = Fastify({ logger: false });
    this.app.get("/healthz", async () => ({ ok: true }));
    this.app.get("/readyz", async (_request, reply) => {
      const result = await this.options.isReady();
      return reply.code(result.ready ? 200 : 503).send(result);
    });
    this.app.get("/metrics", async (_request, reply) => {
      reply.header("content-type", this.registry.contentType);
      return this.registry.metrics();
    });
  }

  counter(name: string, help: string, labelNames: string[] = []) {
    return new Counter({ name, help, labelNames, registers: [this.registry] });
  }

  async start(): Promise<void> {
    await this.app.listen({ host: this.options.host, port: this.options.port });
    this.options.logger.info(
      { host: this.options.host, port: this.options.port },
      "health/metrics listening",
    );
  }

  async stop(): Promise<void> {
    await this.app.close();
  }
}
