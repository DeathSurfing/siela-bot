import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { Logger } from "./logger.js";
import { MUSIC_OPS, parseNodes, workerPath, type FleetNode } from "./nodes.js";
import { FleetPool, type NodePlaybackState } from "./pool.js";
import { BunRegistryStore, FleetRegistry } from "./registry.js";
import { fetchNodeJson, findNode, readJsonSafe, FleetHttpError } from "./fleetHttp.js";

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
const STATE_TIMEOUT_MS = 15_000;

function stripNodeId(body: unknown): unknown {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const { nodeId: _dropped, ...rest } = body as Record<string, unknown>;
    return rest;
  }
  return body ?? {};
}

function asError(statusCode: number, message: string, extra?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { statusCode, ...extra });
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
      (guildId) => this.listNodes(guildId),
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

  private requestGuildId(request: FastifyRequest, body?: Record<string, unknown>): string | null {
    const header = request.headers["x-guild-id"];
    if (typeof header === "string" && header) return header;
    if (body && typeof body.guildId === "string" && body.guildId) return body.guildId;
    return this.guildId();
  }

  private listNodes(guildId?: string | null): Promise<FleetNode[]> {
    return this.registry.list(guildId ?? this.guildId());
  }

  private async resolveNode(nodeId: string, guildId?: string | null): Promise<FleetNode> {
    return findNode(await this.listNodes(guildId), nodeId);
  }

  private async nodeJson(node: FleetNode, path: string, opts?: { method?: string; body?: unknown; timeoutMs?: number; guildId?: string | null }): Promise<unknown> {
    try {
      return await fetchNodeJson(node, path, {
        token: this.options.token,
        method: opts?.method ?? "GET",
        body: opts?.body,
        guildId: opts?.guildId,
        timeoutMs: opts?.timeoutMs ?? STATE_TIMEOUT_MS,
      });
    } catch (error) {
      if (error instanceof FleetHttpError) throw error;
      throw asError(502, (error as Error).message);
    }
  }

  private async readPlaybackState(node: FleetNode, guildId?: string | null): Promise<NodePlaybackState> {
    const state = (await this.nodeJson(node, "/internal/music/state", { guildId })) as { playing?: unknown; current?: unknown };
    if (!state || typeof state !== "object") throw new Error(`Node ${node.id} returned invalid state.`);
    return { playing: state.playing === true, hasCurrent: state.current != null, reachable: true };
  }

  private async assertObjectState(node: FleetNode, path: string, label: string, guildId?: string | null): Promise<Record<string, unknown>> {
    const parsed = await this.nodeJson(node, path, { guildId });
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || "raw" in parsed) {
      throw asError(502, `Node ${node.id} returned invalid ${label}.`);
    }
    return parsed as Record<string, unknown>;
  }

  private async musicBusy(node: FleetNode, guildId?: string | null): Promise<boolean> {
    try {
      const state = await this.readPlaybackState(node, guildId);
      return state.playing || state.hasCurrent;
    } catch {
      return true;
    }
  }

  /**
   * Voice channel a node's music is playing in, or null when it is not
   * connected. TTS can only share a channel, never move a bot that is
   * already streaming somewhere else.
   */
  private async musicChannel(node: FleetNode, guildId?: string | null): Promise<string | null> {
    try {
      const state = (await this.nodeJson(node, "/internal/music/state", { guildId })) as {
        channelId?: unknown;
      } | null;
      return typeof state?.channelId === "string" ? state.channelId : null;
    } catch {
      return null;
    }
  }

  private async ttsEnabled(node: FleetNode, guildId?: string | null): Promise<boolean> {
    try {
      const state = (await this.nodeJson(node, "/internal/tts/state", { guildId })) as { enabled?: unknown } | null;
      return (state as { enabled?: unknown } | null)?.enabled === true;
    } catch {
      return true;
    }
  }

  private async isTtsActive(node: FleetNode, guildId?: string | null): Promise<boolean> {
    return this.ttsEnabled(node, guildId).catch(() => false);
  }

  private async forward(node: FleetNode, path: string, body: unknown, timeoutMs: number, guildId?: string | null): Promise<unknown> {
    return fetchNodeJson(node, path, {
      token: this.options.token,
      method: "POST",
      body: body ?? {},
      guildId,
      timeoutMs,
    });
  }

  private registerRoutes(): void {
    this.app.get("/healthz", async () => ({ ok: true }));

    this.app.get("/v1/music/nodes", async (request) => ({
      nodes: (await this.listNodes(this.requestGuildId(request))).map((node) => ({ nodeId: node.id })),
    }));

    // Session preempt: one guild is one session. Scheduled events call this
    // before playing so worker playback never overlaps event audio. Clears
    // every idle node's queue, disconnects voice, and drops pool
    // reservations. Nodes with an active TTS session are skipped so sticky
    // TTS keeps speaking.
    this.app.post("/v1/session/preempt", async (request) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const guildId = this.requestGuildId(request, body);
      const nodes = await this.listNodes(guildId);
      const settled = await Promise.allSettled(
        nodes.map(async (node) => {
          if (await this.isTtsActive(node, guildId)) {
            return { nodeId: node.id, ok: true as const, skipped: "tts" as const };
          }
          for (const op of ["clear", "disconnect"] as const) {
            await this.forward(node, `/internal/music/${op}`, {}, DEFAULT_TIMEOUT_MS, guildId);
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

    this.app.get("/v1/music/state", async (request: FastifyRequest) => {
      const query = (request.query ?? {}) as { nodeId?: unknown };
      if (typeof query.nodeId !== "string" || !query.nodeId) {
        throw asError(400, "nodeId query parameter is required.");
      }
      const guildId = this.requestGuildId(request);
      const node = await this.resolveNode(query.nodeId, guildId);
      return this.assertObjectState(node, "/internal/music/state", "state", guildId);
    });

    this.app.get("/v1/music/state-all", async (request) => {
      const guildId = this.requestGuildId(request);
      const nodes = await this.listNodes(guildId);
      const settled = await Promise.allSettled(
        nodes.map(async (node) => {
          try {
            const state = await this.assertObjectState(node, "/internal/music/state", "state", guildId);
            return { nodeId: node.id, ok: true as const, state };
          } catch (error) {
            throw new Error(error instanceof Error ? error.message : String(error));
          }
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
      const guildId = this.requestGuildId(request, body);
      if (nodeId || op !== "play") {
        if (!nodeId) {
          throw asError(400, "nodeId is required for this operation.");
        }
        const node = await this.resolveNode(nodeId, guildId);
        return this.forward(
          node,
          workerPath(op),
          stripNodeId(body),
          op === "play" ? PLAY_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
          guildId,
        );
      }
      // Auto-route: semaphore over free nodes. Rejects 429 when the fleet is full.
      const node = await this.pool.acquire(guildId);
      try {
        return {
          nodeId: node.id,
          result: await this.forward(
            node,
            workerPath(op),
            stripNodeId(body),
            PLAY_TIMEOUT_MS,
            guildId,
          ),
        };
      } finally {
        this.pool.release(node.id);
      }
    });

    // Everything else goes straight to the commander.
    this.app.all("/v1/*", async (request) => this.proxy(request));
    this.registerTtsRoutes();
  }

  /** Sticky TTS: enable/disable/speak fan out by node. Auto-enable picks the
   * first node with idle music and no TTS session, so TTS binds to one bot
   * until it is turned off. */
  private registerTtsRoutes(): void {
    this.app.post("/v1/tts/enable", async (request: FastifyRequest) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const channelId = typeof body.channelId === "string" ? body.channelId : undefined;
      if (!channelId) throw asError(400, "channelId is required.");
      const guildId = this.requestGuildId(request, body);
      const nodeId = typeof body.nodeId === "string" ? body.nodeId : undefined;
      if (nodeId) {
        const node = await this.resolveNode(nodeId, guildId);
        await this.forward(node, "/internal/tts/enable", { channelId }, DEFAULT_TIMEOUT_MS, guildId);
        return { nodeId };
      }
      const nodes = await this.listNodes(guildId);

      // First pass: an idle node with no TTS session, so speech does not have
      // to share a channel when it does not need to.
      const states = await Promise.all(
        nodes.map(async (node) => {
          const [busy, tts] = await Promise.all([this.musicBusy(node, guildId), this.ttsEnabled(node, guildId)]);
          return { node, busy, tts };
        }),
      );

      for (const { node, busy, tts } of states) {
        if (busy || tts) continue;
        await this.forward(node, "/internal/tts/enable", { channelId }, DEFAULT_TIMEOUT_MS, guildId);
        return { nodeId: node.id };
      }

      // Second pass: every node is busy with music. Nodes that can mix TTS
      // over music take the session, but only if their music is already in
      // the requested channel; otherwise the bot would have to move.
      for (const { node, tts } of states) {
        if (tts || !node.ttsMix) continue;
        const current = await this.musicChannel(node, guildId);
        if (current && current !== channelId) continue;
        await this.forward(node, "/internal/tts/enable", { channelId }, DEFAULT_TIMEOUT_MS, guildId);
        return { nodeId: node.id, mixed: true };
      }

      throw Object.assign(
        new Error("All voice nodes are busy. Add more worker nodes for more concurrent streams."),
        { statusCode: 429, code: "all_nodes_busy" },
      );
    });

    this.app.post("/v1/tts/disable", async (request: FastifyRequest) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const nodeId = typeof body.nodeId === "string" ? body.nodeId : undefined;
      if (!nodeId) throw asError(400, "nodeId is required.");
      const guildId = this.requestGuildId(request, body);
      const node = await this.resolveNode(nodeId, guildId);
      await this.forward(node, "/internal/tts/disable", {}, DEFAULT_TIMEOUT_MS, guildId);
      return { ok: true };
    });

    this.app.post("/v1/tts/speak", async (request: FastifyRequest) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const nodeId = typeof body.nodeId === "string" ? body.nodeId : undefined;
      const utterance = typeof body.utterance === "string" ? body.utterance : undefined;
      if (!nodeId || !utterance) throw asError(400, "nodeId and utterance are required.");
      const guildId = this.requestGuildId(request, body);
      const node = await this.resolveNode(nodeId, guildId);
      await this.forward(
        node,
        "/internal/tts/speak",
        { utterance, speakerId: typeof body.speakerId === "string" ? body.speakerId : undefined },
        DEFAULT_TIMEOUT_MS,
        guildId,
      );
      return { ok: true };
    });

    this.app.get("/v1/tts/state", async (request: FastifyRequest) => {
      const query = (request.query ?? {}) as { nodeId?: unknown };
      if (typeof query.nodeId !== "string" || !query.nodeId) {
        throw asError(400, "nodeId query parameter is required.");
      }
      const guildId = this.requestGuildId(request);
      const node = await this.resolveNode(query.nodeId, guildId);
      return this.assertObjectState(node, "/internal/tts/state", "tts state", guildId);
    });
  }

  /** Transparent proxy for non-music control routes. */
  private async proxy(request: FastifyRequest): Promise<unknown> {
    const url = new URL(request.url, "http://router");
    const target = `${this.options.commanderUrl.replace(/\/+$/, "")}${url.pathname}${url.search}`;
    const headers: Record<string, string> = { authorization: `Bearer ${this.options.token}` };
    const contentType = request.headers["content-type"];
    if (typeof contentType === "string") headers["content-type"] = contentType;
    const guildHeader = request.headers["x-guild-id"];
    if (typeof guildHeader === "string" && guildHeader) headers["x-guild-id"] = guildHeader;
    const actorHeader = request.headers["x-actor"];
    if (typeof actorHeader === "string" && actorHeader) headers["x-actor"] = actorHeader;
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
      throw asError(502, "Commander is unreachable.");
    }
    const parsed = await readJsonSafe(response);
    if (!response.ok) {
      throw asError(response.status, "Commander request failed.", { payload: parsed });
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
