import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { Logger } from "./logger.js";
import { MUSIC_OPS, parseNodes, workerPath, type FleetNode } from "./nodes.js";

export interface RouterOptions {
  token: string;
  commanderUrl: string;
  nodesRaw: string | undefined;
  logger: Logger;
}

const PLAY_TIMEOUT_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 30_000;

function stripNodeId(body: unknown): unknown {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const { nodeId: _dropped, ...rest } = body as Record<string, unknown>;
    return rest;
  }
  return body ?? {};
}

export class RouterServer {
  private readonly app: FastifyInstance;
  private readonly nodes: FleetNode[];

  constructor(private readonly options: RouterOptions) {
    this.nodes = parseNodes(options.nodesRaw);
    this.app = Fastify({ logger: false, bodyLimit: 16 * 1024 });
    this.app.addHook("preHandler", async (request, reply) => {
      if (!this.validToken(request.headers.authorization)) {
        return reply.code(401).send({ error: { code: "unauthorized", message: "Invalid router token" } });
      }
    });
    this.app.setErrorHandler((error, request, reply) => {
      const statusCode =
        typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
      if (statusCode >= 500) this.options.logger.error({ err: error, url: request.url }, "router error");
      const payload = (error as { payload?: unknown }).payload;
      if (payload !== undefined) {
        void reply.code(statusCode).send(payload);
        return;
      }
      const code = statusCode >= 500 ? "internal_error" : "bad_request";
      void reply.code(statusCode).send({ error: { code, message: (error as Error).message } });
    });
    this.registerRoutes();
  }

  private validToken(header: string | undefined): boolean {
    if (!header?.startsWith("Bearer ")) return false;
    const provided = Buffer.from(header.slice("Bearer ".length));
    const expected = Buffer.from(this.options.token);
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  }

  private nodeUrl(nodeId: string, path: string): string {
    const node = this.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) throw Object.assign(new Error(`Unknown voice node: ${nodeId}.`), { statusCode: 400 });
    return `${node.baseUrl}${path}`;
  }

  private async forward(url: string, body: unknown, timeoutMs: number): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.options.token}`,
        },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      this.options.logger.warn({ err: error, url }, "fleet node unreachable");
      throw Object.assign(new Error("Voice node is unreachable."), { statusCode: 502 });
    }
    const text = await response.text().catch(() => "");
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text };
    }
    if (!response.ok) {
      const message =
        typeof parsed === "object" && parsed !== null && "error" in parsed
          ? String((parsed as { error: { message?: string } }).error?.message ?? response.status)
          : `Voice node returned ${response.status}.`;
      throw Object.assign(new Error(message), { statusCode: response.status >= 500 ? 502 : response.status });
    }
    return parsed;
  }

  private registerRoutes(): void {
    this.app.get("/healthz", async () => ({ ok: true }));

    this.app.get("/v1/music/nodes", async () => ({
      nodes: this.nodes.map((node) => ({ nodeId: node.id })),
    }));

    this.app.get("/v1/music/state-all", async () => {
      const settled = await Promise.allSettled(
        this.nodes.map(async (node) => {
          const response = await fetch(`${node.baseUrl}/internal/music/state`, {
            headers: { authorization: `Bearer ${this.options.token}` },
            signal: AbortSignal.timeout(15_000),
          });
          const text = await response.text().catch(() => "");
          const state = text ? JSON.parse(text) : null;
          if (!response.ok) throw new Error(`Node ${node.id} returned ${response.status}.`);
          return { nodeId: node.id, ok: true as const, state };
        }),
      );
      return settled.map((entry, index) =>
        entry.status === "fulfilled"
          ? entry.value
          : { nodeId: this.nodes[index]!.id, ok: false as const, error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason) },
      );
    });

    this.app.post("/v1/music/:op", async (request: FastifyRequest<{ Params: { op: string } }>) => {
      const op = request.params.op;
      if (!MUSIC_OPS.has(op)) {
        return this.proxy(request);
      }
      const body = (request.body ?? {}) as Record<string, unknown>;
      const nodeId = typeof body.nodeId === "string" ? body.nodeId : undefined;
      if (!nodeId) {
        throw Object.assign(new Error("nodeId is required when a voice fleet is configured."), { statusCode: 400 });
      }
      return this.forward(
        this.nodeUrl(nodeId, workerPath(op)),
        stripNodeId(body),
        op === "play" ? PLAY_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
      );
    });

    // Everything else goes straight to the commander.
    this.app.all("/v1/*", async (request) => this.proxy(request));
  }

  /** Transparent proxy for non-music control routes. */
  private async proxy(request: FastifyRequest): Promise<unknown> {
    const url = new URL(request.url, "http://router");
    const target = `${this.options.commanderUrl.replace(/\/+$/, "")}${url.pathname}${url.search}`;
    const headers: Record<string, string> = { authorization: `Bearer ${this.options.token}` };
    const contentType = request.headers["content-type"];
    if (typeof contentType === "string") headers["content-type"] = contentType;
    let response: Response;
    try {
      response = await fetch(target, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : JSON.stringify(request.body ?? {}),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      this.options.logger.warn({ err: error, target }, "commander unreachable");
      throw Object.assign(new Error("Commander is unreachable."), { statusCode: 502 });
    }
    const text = await response.text().catch(() => "");
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text };
    }
    if (!response.ok) {
      throw Object.assign(new Error("Commander request failed."), {
        statusCode: response.status,
        payload: parsed,
      });
    }
    return parsed;
  }

  async start(host: string, port: number): Promise<void> {
    await this.app.listen({ host, port });
  }

  async stop(): Promise<void> {
    await this.app.close().catch(() => undefined);
  }
}
