import { timingSafeEqual } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { DashboardConfig } from "./config.js";
import {
  CONFIG_SECTIONS,
  ControlApiError,
  MUSIC_ACTIONS,
  type ConfigSection,
  type ControlClient,
  type MusicAction,
  createControlClient,
} from "./control-client.js";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  constantTimePasswordMatch,
  csrfToken,
  issueSession,
  readCookie,
  verifyCsrf,
  verifySession,
} from "./session.js";

const loginSchema = z.object({ password: z.string().min(1).max(1024) });
const featureSchema = z.object({ enabled: z.boolean() });
const bodySchema = z.record(z.string(), z.unknown());
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
const guildPattern = /^\d{1,20}$/;
const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

interface LoginWindow {
  startedAt: number;
  attempts: number;
}

export interface DashboardServerOptions {
  config: DashboardConfig;
  publicDir: string;
  control?: ControlClient;
  now?: () => number;
}

function apiError(reply: FastifyReply, statusCode: number, code: string, message: string): void {
  void reply.code(statusCode).send({ error: { code, message } });
}

function validCsrf(request: FastifyRequest, reply: FastifyReply, secret: string): string | null {
  const cookie = readCookie(request.headers.cookie);
  if (!cookie || !verifySession(cookie, secret)) {
    apiError(reply, 401, "unauthorized", "Your session has expired. Sign in again.");
    return null;
  }
  const token = request.headers["x-csrf-token"];
  if (!verifyCsrf(cookie, typeof token === "string" ? token : undefined, secret)) {
    apiError(reply, 403, "csrf_mismatch", "This request could not be verified. Reload the page and try again.");
    return null;
  }
  return cookie;
}

export function resolvePublicPath(publicDir: string, requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;

  const root = path.resolve(publicDir);
  const candidate = path.resolve(root, decoded.replace(/^\/+/, ""));
  const relative = path.relative(root, candidate);
  return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    ? candidate
    : null;
}

function getGuildId(value: string, reply: FastifyReply): string | null {
  if (!guildPattern.test(value)) {
    apiError(reply, 400, "invalid_guild_id", "Guild ID must contain only digits.");
    return null;
  }
  return value;
}

function getIdentifier(value: string, label: string, reply: FastifyReply): string | null {
  if (!idPattern.test(value)) {
    apiError(reply, 400, "invalid_identifier", `${label} is invalid.`);
    return null;
  }
  return value;
}

export function createDashboardServer(options: DashboardServerOptions): FastifyInstance {
  const { config } = options;
  const now = options.now ?? Date.now;
  const control = options.control ?? createControlClient(config.CONTROL_API_URL, config.MCP_TOKEN);
  const publicRoot = path.resolve(options.publicDir);
  const loginWindows = new Map<string, LoginWindow>();
  const app = Fastify({
    logger: false,
    bodyLimit: 64 * 1024,
    trustProxy: config.DASHBOARD_TRUST_PROXY,
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("content-security-policy", "default-src 'self'; img-src 'self' https://cdn.discordapp.com data:; frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ControlApiError) {
      return apiError(reply, error.statusCode, error.code, error.message);
    }
    const caughtError = error instanceof Error ? error : new Error(String(error));
    const reportedStatus = (caughtError as Error & { statusCode?: unknown }).statusCode;
    const statusCode = typeof reportedStatus === "number" && reportedStatus < 500 ? reportedStatus : 500;
    if (statusCode >= 500) request.log.error({ err: caughtError }, "dashboard request failed");
    return apiError(
      reply,
      statusCode,
      statusCode === 400 ? "bad_request" : "internal_error",
      statusCode === 400 ? caughtError.message : "The dashboard could not complete this request.",
    );
  });

  const authenticated = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const cookie = readCookie(request.headers.cookie);
    if (!verifySession(cookie, config.DASHBOARD_SESSION_SECRET, now())) {
      apiError(reply, 401, "unauthorized", "Your session has expired. Sign in again.");
    }
  };

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/api/session", async (request) => {
    const cookie = readCookie(request.headers.cookie);
    if (!verifySession(cookie, config.DASHBOARD_SESSION_SECRET, now())) return { authenticated: false };
    return { authenticated: true, csrfToken: csrfToken(cookie!, config.DASHBOARD_SESSION_SECRET) };
  });

  app.post("/api/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return apiError(reply, 400, "invalid_login", "Enter your dashboard password.");

    const ip = request.ip;
    const timestamp = now();
    for (const [address, window] of loginWindows) {
      if (timestamp - window.startedAt >= 5 * 60_000) loginWindows.delete(address);
    }
    const window = loginWindows.get(ip);
    if (window && timestamp - window.startedAt >= 5 * 60_000) loginWindows.delete(ip);
    const current = loginWindows.get(ip) ?? { startedAt: timestamp, attempts: 0 };
    if (current.attempts >= 5) {
      reply.header("retry-after", String(Math.max(1, Math.ceil((current.startedAt + 5 * 60_000 - timestamp) / 1000))));
      return apiError(reply, 429, "rate_limited", "Too many sign-in attempts. Wait five minutes and try again.");
    }
    current.attempts += 1;
    loginWindows.set(ip, current);

    if (!constantTimePasswordMatch(config.DASHBOARD_PASSWORD, parsed.data.password)) {
      return apiError(reply, 401, "invalid_password", "That password is not correct.");
    }

    loginWindows.delete(ip);
    const cookie = issueSession(config.DASHBOARD_SESSION_SECRET, timestamp);
    const secure = config.DASHBOARD_SECURE_COOKIES || request.protocol === "https" ? "; Secure" : "";
    reply.header(
      "set-cookie",
      `${SESSION_COOKIE}=${cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure}`,
    );
    return { csrfToken: csrfToken(cookie, config.DASHBOARD_SESSION_SECRET) };
  });

  app.post("/api/logout", async (request, reply) => {
    validCsrf(request, reply, config.DASHBOARD_SESSION_SECRET);
    if (reply.sent) return;
    reply.header("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    return { ok: true };
  });

  const get = (url: string, handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) => {
    app.get(url, { preHandler: authenticated }, async (request, reply) => handler(request, reply));
  };
  const mutate = (url: string, handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) => {
    app.route({
      method: "PATCH",
      url,
      preHandler: async (request, reply) => {
        await authenticated(request, reply);
        if (!reply.sent) validCsrf(request, reply, config.DASHBOARD_SESSION_SECRET);
      },
      handler: async (request, reply) => handler(request, reply),
    });
  };

  get("/api/status", () => control.getStatus());
  get("/api/guilds", () => control.getGuilds());
  get("/api/commands", () => control.getCommands());
  get("/api/guilds/:guildId/features", (request, reply) => {
    const guildId = getGuildId((request.params as { guildId: string }).guildId, reply);
    return guildId ? control.getFeatures(guildId) : Promise.resolve(undefined);
  });
  mutate("/api/guilds/:guildId/features/:featureId", async (request, reply) => {
    const params = request.params as { guildId: string; featureId: string };
    const guildId = getGuildId(params.guildId, reply);
    const featureId = getIdentifier(params.featureId, "Feature ID", reply);
    const body = featureSchema.safeParse(request.body);
    if (!body.success) return apiError(reply, 400, "invalid_body", "Feature state must include an enabled boolean.");
    return guildId && featureId ? control.updateFeature(guildId, featureId, body.data.enabled) : undefined;
  });
  get("/api/guilds/:guildId/audit", (request, reply) => {
    const guildId = getGuildId((request.params as { guildId: string }).guildId, reply);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(request.query);
    if (!query.success) return Promise.resolve(apiError(reply, 400, "invalid_limit", "Audit limit must be between 1 and 100."));
    return guildId ? control.getAudit(guildId, query.data.limit) : Promise.resolve(undefined);
  });
  get("/api/guilds/:guildId/music", (request, reply) => {
    const guildId = getGuildId((request.params as { guildId: string }).guildId, reply);
    return guildId ? control.getMusic(guildId) : Promise.resolve(undefined);
  });
  app.post<{ Params: { guildId: string; action: string } }>(
    "/api/guilds/:guildId/music/:action",
    { preHandler: [authenticated, async (request, reply) => { validCsrf(request, reply, config.DASHBOARD_SESSION_SECRET); }] },
    async (request, reply) => {
      const guildId = getGuildId(request.params.guildId, reply);
      if (!MUSIC_ACTIONS.includes(request.params.action as MusicAction)) {
        return apiError(reply, 404, "unknown_music_action", "That music action is not available.");
      }
      const body = bodySchema.safeParse(request.body ?? {});
      if (!body.success) return apiError(reply, 400, "invalid_body", "Music actions require a JSON object.");
      return guildId ? control.musicAction(guildId, request.params.action as MusicAction, body.data) : undefined;
    },
  );
  get("/api/guilds/:guildId/config", (request, reply) => {
    const guildId = getGuildId((request.params as { guildId: string }).guildId, reply);
    return guildId ? control.getConfig(guildId) : Promise.resolve(undefined);
  });
  app.patch<{ Params: { guildId: string; section: string } }>(
    "/api/guilds/:guildId/config/:section",
    { preHandler: [authenticated, async (request, reply) => { validCsrf(request, reply, config.DASHBOARD_SESSION_SECRET); }] },
    async (request, reply) => {
      const guildId = getGuildId(request.params.guildId, reply);
      if (!CONFIG_SECTIONS.includes(request.params.section as ConfigSection)) {
        return apiError(reply, 404, "unknown_config_section", "That settings section is not available.");
      }
      const body = bodySchema.safeParse(request.body);
      if (!body.success) return apiError(reply, 400, "invalid_body", "Settings must be a JSON object.");
      return guildId ? control.patchConfig(guildId, request.params.section as ConfigSection, body.data) : undefined;
    },
  );

  app.get("/", async (_request, reply) => serveStatic(publicRoot, "index.html", reply));
  app.get("/*", async (request, reply) => {
    const requestedPath = (request.params as { "*": string })["*"];
    return serveStatic(publicRoot, requestedPath, reply);
  });

  return app;
}

async function serveStatic(publicRoot: string, requestPath: string, reply: FastifyReply): Promise<unknown> {
  const candidate = resolvePublicPath(publicRoot, requestPath);
  if (!candidate) return reply.code(404).send({ error: { code: "not_found", message: "Not found." } });
  try {
    const [rootReal, fileReal] = await Promise.all([realpath(publicRoot), realpath(candidate)]);
    if (fileReal !== rootReal && !fileReal.startsWith(`${rootReal}${path.sep}`)) {
      return reply.code(404).send({ error: { code: "not_found", message: "Not found." } });
    }
    const content = await readFile(fileReal);
    const contentType = MIME_TYPES[path.extname(fileReal)] ?? "application/octet-stream";
    return reply.type(contentType).send(content);
  } catch {
    return reply.code(404).send({ error: { code: "not_found", message: "Not found." } });
  }
}
