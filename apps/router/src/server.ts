import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { Logger } from "./logger.js";
import { MUSIC_OPS, parseNodes, workerPath, type FleetNode } from "./nodes.js";
import { FleetPool, type NodePlaybackState } from "./pool.js";
import { BunRegistryStore, FleetRegistry } from "./registry.js";

export interface RouterOptions {
  token: string;
  commanderUrl: string;
  nodesRaw: string | undefined;
  valkeyUrl?: string | null;
  guildId?: string | null;
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
  private readonly registry: FleetRegistry;
  private readonly pool: FleetPool;
  private readonly store: BunRegistryStore | null;

  constructor(private readonly options: RouterOptions) {
    const staticNodes = parseNodes(options.nodesRaw);
    this.store = options.valkeyUrl ? new BunRegistryStore(options.valkeyUrl, options.logger) : null;
    this.registry = new FleetRegistry(this.store, staticNodes);
    this.pool = new FleetPool(
      (guildId) => this.registry.list(guildId ?? this.guildId()),
      (node) => this.readPlaybackState(node),
    );
    this.app = Fastify({ logger: false, bodyLimit: 16 * 1024 });
    this.app.addHook("preHandler", async (request, reply) => {
      if (request.url === "/healthz") return;
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
      const code =
        typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : statusCode >= 500
            ? "internal_error"
            : "bad_request";
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

  private guildId(): string | null {
    return this.options.guildId ?? null;
  }

  private async nodeUrl(nodeId: string, path: string): Promise<string> {
    const nodes = await this.registry.list(this.guildId());
    const node = nodes.find((candidate) => candidate.id === nodeId);
    if (!node) throw Object.assign(new Error(`Unknown voice node: ${nodeId}.`), { statusCode: 400 });
    return `${node.baseUrl}${path}`;
  }

  private async readPlaybackState(node: FleetNode): Promise<NodePlaybackState> {
    const response = await fetch(`${node.baseUrl}/internal/music/state`, {
      headers: { authorization: `Bearer ${this.options.token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Node ${node.id} returned ${response.status}.`);
    const state = (await response.json()) as { playing?: unknown; current?: unknown };
    return { playing: state.playing === true, hasCurrent: state.current != null, reachable: true };
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
      nodes: (await this.registry.list(this.guildId())).map((node) => ({ nodeId: node.id })),
    }));

    // Session preempt: one guild is one session. Scheduled events call this
    // before playing so worker playback never overlaps event audio. Clears
    // every node's queue, disconnects voice, and drops pool reservations.
    this.app.post("/v1/session/preempt", async () => {
      const nodes = await this.registry.list(this.guildId());
      const settled = await Promise.allSettled(
        nodes.map(async (node) => {
          for (const op of ["clear", "disconnect"] as const) {
            const response = await fetch(`${node.baseUrl}/internal/music/${op}`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${this.options.token}`,
              },
              body: "{}",
              signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
            });
            if (!response.ok) throw new Error(`Node ${node.id} ${op} returned ${response.status}.`);
          }
          return { nodeId: node.id, ok: true as const };
        }),
      );
      this.pool.releaseAll();
      return settled.map((entry, index) =>
        entry.status === "fulfilled"
          ? entry.value
          : { nodeId: nodes[index]!.id, ok: false as const, error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason) },
      );
    });

    this.app.get("/v1/music/state-all", async () => {
      const nodes = await this.registry.list(this.guildId());
      const settled = await Promise.allSettled(
        nodes.map(async (node) => {
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
          : { nodeId: nodes[index]!.id, ok: false as const, error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason) },
      );
    });

    this.app.post("/v1/music/:op", async (request: FastifyRequest<{ Params: { op: string } }>) => {
      const op = request.params.op;
      if (!MUSIC_OPS.has(op)) {
        return this.proxy(request);
      }
      const body = (request.body ?? {}) as Record<string, unknown>;
      const nodeId = typeof body.nodeId === "string" ? body.nodeId : undefined;
      if (nodeId || op !== "play") {
        if (!nodeId) {
          throw Object.assign(new Error("nodeId is required for this operation."), { statusCode: 400 });
        }
        return this.forward(
          await this.nodeUrl(nodeId, workerPath(op)),
          stripNodeId(body),
          op === "play" ? PLAY_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
        );
      }
      // Auto-route: semaphore over free nodes. Rejects 429 when the fleet is full.
      const node = await this.pool.acquire(this.guildId());
      try {
        return {
          nodeId: node.id,
          result: await this.forward(
            `${node.baseUrl}${workerPath(op)}`,
            stripNodeId(body),
            PLAY_TIMEOUT_MS,
          ),
        };
      } finally {
        this.pool.release(node.id);
      }
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
    await this.store?.start();
    await this.app.listen({ host, port });
  }

  async stop(): Promise<void> {
    await this.app.close().catch(() => undefined);
    this.store?.stop();
  }
}
