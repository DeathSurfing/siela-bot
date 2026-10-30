import { timingSafeEqual } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { oauthConfig, type DashboardConfig } from "./config.js";
import {
  CAH_ACTIONS,
  CASINO_GAMES,
  CONFIG_SECTIONS,
  ControlApiError,
  ECONOMY_ACTIONS,
  MUSIC_ACTIONS,
  RESOLVE_KINDS,
  STOCK_ACTIONS,
  TAMBOLA_ACTIONS,
  type CahAction,
  type CasinoGame,
  type ConfigSection,
  type ControlClient,
  type EconomyAction,
  type MusicAction,
  type StockAction,
  type ScheduledEventPayload,
  type ScheduledEventUpdatePayload,
  type TambolaAction,
  createControlClient,
} from "./control-client.js";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  constantTimePasswordMatch,
  constantTimeTokenMatch,
  csrfToken,
  issueSession,
  readCookie,
  verifyCsrf,
  verifySession,
  type SessionUser,
} from "./session.js";
import { createDiscordOAuth, createOAuthState, isOAuthOwner, type DiscordOAuth } from "./oauth.js";

const loginSchema = z.object({ password: z.string().min(1).max(1024) });
const featureSchema = z.object({ enabled: z.boolean() });
const birthdaySchema = z.object({
  month: z.number().int(),
  day: z.number().int(),
  year: z.number().int().nullable().optional(),
}).strict();
const bodySchema = z.record(z.string(), z.unknown());
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
const guildPattern = /^\d{1,20}$/;
const snowflakePattern = /^\d{17,20}$/;
const scheduledEventFields = {
  name: z.string().trim().min(1).max(80),
  channelId: z.string().regex(snowflakePattern, "Channel ID must be a Discord snowflake."),
  sourceUrl: z.string().trim().min(1).max(2048),
  startAt: z.coerce.date(),
  repeat: z.enum(["none", "daily", "weekly"]),
  enabled: z.boolean(),
};
const scheduledEventCreateSchema = z.object({ ...scheduledEventFields, enabled: z.boolean().default(true) }).strict();
const scheduledEventUpdateSchema = z.object(scheduledEventFields).partial().strict();
const cahHostSchema = z
  .object({
    channelId: z.string().regex(snowflakePattern, "Channel ID must be a Discord snowflake."),
    pointsGoal: z.number().int().min(1).max(50).optional(),
    maxPlayers: z.number().int().min(3).max(10).optional(),
  })
  .strict();
const gameIdSchema = z.string().min(1).max(32);
const cahActionSchema = z
  .object({ gameId: gameIdSchema, roundIndex: z.number().int().min(0).optional() })
  .strict();
const tambolaActionSchema = z.object({ gameId: gameIdSchema }).strict();
const resolveQuerySchema = z
  .object({
    q: z.string().trim().min(1, "Enter a name to search for.").max(80, "Search text must be at most 80 characters."),
    kind: z.enum(RESOLVE_KINDS).optional(),
  })
  .strict();
const stockTradeSchema = z
  .object({
    symbol: z.string().trim().min(1, "Symbol is required.").max(8, "Symbol must be at most 8 characters.").regex(/^[A-Za-z]+$/, "Symbol may only contain letters."),
    shares: z.number().int().positive("Shares must be a positive whole number.").max(1_000_000, "Shares must be at most 1,000,000."),
  })
  .strict();
const requestIdSchema = z.string().min(8).max(100);
const casinoCoinflipSchema = z
  .object({
    bet: z.number().int().positive(),
    side: z.enum(["heads", "tails"]),
    requestId: requestIdSchema,
  })
  .strict();
const casinoSlotsSchema = z
  .object({ bet: z.number().int().positive(), requestId: requestIdSchema })
  .strict();
const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

interface LoginWindow {
  startedAt: number;
  attempts: number;
}

export interface DashboardServerOptions {
  config: DashboardConfig;
  publicDir: string;
  control?: ControlClient;
  oauth?: DiscordOAuth | null;
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

function getScheduledEventId(value: string, reply: FastifyReply): number | null {
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id)) {
    apiError(reply, 400, "invalid_event_id", "Scheduled event ID is invalid.");
    return null;
  }
  return id;
}

function toBirthday(value: unknown): { month: number; day: number; birthYear: number | null } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.month !== "number" || typeof record.day !== "number") return null;
  return {
    month: record.month,
    day: record.day,
    birthYear: typeof record.birthYear === "number" ? record.birthYear : null,
  };
}

export function createDashboardServer(options: DashboardServerOptions): FastifyInstance {
  const { config } = options;
  const now = options.now ?? Date.now;
  const control = options.control ?? createControlClient(config.CONTROL_API_URL, config.MCP_TOKEN);
  const oauthSettings = oauthConfig(config);
  const oauth = options.oauth !== undefined ? options.oauth : oauthSettings ? createDiscordOAuth(oauthSettings) : null;
  const password = config.DASHBOARD_PASSWORD;
  const passwordEnabled = Boolean(password);
  const publicRoot = path.resolve(options.publicDir);
  const loginWindows = new Map<string, LoginWindow>();
  const app = Fastify({
    logger: false,
    bodyLimit: 64 * 1024,
    trustProxy: config.DASHBOARD_TRUST_PROXY,
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("content-security-policy", "default-src 'self'; img-src 'self' https://cdn.discordapp.com https://i.ytimg.com https://img.youtube.com https://*.sndcdn.com data:; frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
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

  const sessionUser = (request: FastifyRequest): SessionUser | null => {
    const cookie = readCookie(request.headers.cookie);
    return verifySession(cookie, config.DASHBOARD_SESSION_SECRET, now())?.user ?? null;
  };

  const isAdministrator = async (guildId: string, userId: string): Promise<boolean> => {
    try {
      return (await control.authorize(guildId, userId)).administrator === true;
    } catch {
      return false;
    }
  };

  const requireAdministrator = async (
    request: FastifyRequest,
    reply: FastifyReply,
    guildId: string,
  ): Promise<SessionUser | null> => {
    const user = sessionUser(request);
    if (user && (await isAdministrator(guildId, user.id))) return user;
    apiError(
      reply,
      403,
      "administrator_required",
      "You need the Administrator permission in this server to change its features and settings.",
    );
    return null;
  };

  const birthdayUser = (request: FastifyRequest, reply: FastifyReply): SessionUser | null => {
    const user = sessionUser(request);
    if (user && snowflakePattern.test(user.id)) return user;
    apiError(reply, 403, "discord_account_required", "Sign in with Discord to manage your birthday.");
    return null;
  };

  const gameUser = (request: FastifyRequest, reply: FastifyReply): SessionUser | null => {
    const user = sessionUser(request);
    if (user && snowflakePattern.test(user.id)) return user;
    apiError(reply, 403, "discord_account_required", "Sign in with Discord to use game controls.");
    return null;
  };

  const economyUser = (request: FastifyRequest, reply: FastifyReply): SessionUser | null => {
    const user = sessionUser(request);
    if (user && snowflakePattern.test(user.id)) return user;
    apiError(reply, 403, "discord_account_required", "Sign in with Discord to use the economy.");
    return null;
  };

  app.get("/healthz", async () => ({ ok: true }));

  const secureSuffix = (request: FastifyRequest): string =>
    config.DASHBOARD_SECURE_COOKIES || request.protocol === "https" ? "; Secure" : "";

  app.get("/api/session", async (request) => {
    const cookie = readCookie(request.headers.cookie);
    const session = verifySession(cookie, config.DASHBOARD_SESSION_SECRET, now());
    if (!session) return { authenticated: false, oauth: Boolean(oauth), password: passwordEnabled };
    return {
      authenticated: true,
      csrfToken: csrfToken(cookie!, config.DASHBOARD_SESSION_SECRET),
      user: session.user ?? null,
      oauth: Boolean(oauth),
      password: passwordEnabled,
    };
  });

  app.get("/auth/discord", async (request, reply) => {
    if (!oauth || !oauthSettings) {
      return reply.code(404).send({ error: { code: "oauth_disabled", message: "Discord sign-in is not configured." } });
    }
    const state = createOAuthState();
    reply.header(
      "set-cookie",
      `${OAUTH_STATE_COOKIE}=${state}; Path=/auth/discord; HttpOnly; SameSite=Lax; Max-Age=${OAUTH_STATE_TTL_SECONDS}${secureSuffix(request)}`,
    );
    return reply.redirect(oauth.authorizeUrl(state));
  });

  app.get("/auth/discord/callback", async (request, reply) => {
    if (!oauth || !oauthSettings) {
      return reply.code(404).send({ error: { code: "oauth_disabled", message: "Discord sign-in is not configured." } });
    }
    const query = request.query as { code?: unknown; state?: unknown; error?: unknown };
    const clearState = `${OAUTH_STATE_COOKIE}=; Path=/auth/discord; HttpOnly; SameSite=Lax; Max-Age=0${secureSuffix(request)}`;
    const expectedState = readCookie(request.headers.cookie, OAUTH_STATE_COOKIE);
    if (typeof query.error === "string") {
      reply.header("set-cookie", clearState);
      return reply.redirect("/?oauth=cancelled");
    }
    if (
      typeof query.state !== "string" ||
      !constantTimeTokenMatch(expectedState ?? "", query.state)
    ) {
      reply.header("set-cookie", clearState);
      return reply.redirect("/?oauth=state");
    }
    if (typeof query.code !== "string" || !query.code) {
      reply.header("set-cookie", clearState);
      return reply.redirect("/?oauth=failed");
    }
    try {
      const user = await oauth.exchange(query.code);
      if (!isOAuthOwner(oauthSettings, user)) {
        reply.header("set-cookie", clearState);
        return reply.redirect("/?oauth=denied");
      }
      const cookie = issueSession(config.DASHBOARD_SESSION_SECRET, now(), user);
      reply.header("set-cookie", [
        clearState,
        `${SESSION_COOKIE}=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secureSuffix(request)}`,
      ]);
      return reply.redirect("/");
    } catch {
      reply.header("set-cookie", clearState);
      return reply.redirect("/?oauth=failed");
    }
  });

  app.post("/api/login", async (request, reply) => {
    if (!password) {
      return apiError(reply, 404, "password_disabled", "Password sign-in is disabled on this dashboard. Use Discord to sign in.");
    }
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

    if (!constantTimePasswordMatch(password, parsed.data.password)) {
      return apiError(reply, 401, "invalid_password", "That password is not correct.");
    }

    loginWindows.delete(ip);
    const user: SessionUser = { id: "operator", name: "Operator", avatarUrl: null };
    const cookie = issueSession(config.DASHBOARD_SESSION_SECRET, timestamp, user);
    reply.header(
      "set-cookie",
      `${SESSION_COOKIE}=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secureSuffix(request)}`,
    );
    return { csrfToken: csrfToken(cookie, config.DASHBOARD_SESSION_SECRET), user };
  });

  app.post("/api/logout", async (request, reply) => {
    validCsrf(request, reply, config.DASHBOARD_SESSION_SECRET);
    if (reply.sent) return;
    reply.header("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureSuffix(request)}`);
    return { ok: true };
  });

  const get = (url: string, handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) => {
    app.get(url, { preHandler: authenticated }, async (request, reply) => handler(request, reply));
  };
  const mutation = (
    method: "PATCH" | "PUT" | "DELETE",
    url: string,
    handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
  ) => {
    app.route({
      method,
      url,
      preHandler: async (request, reply) => {
        await authenticated(request, reply);
        if (!reply.sent) validCsrf(request, reply, config.DASHBOARD_SESSION_SECRET);
      },
      handler: async (request, reply) => handler(request, reply),
    });
  };
  const post = (
    url: string,
    handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
  ) => {
    app.post(url, {
      preHandler: async (request, reply) => {
        await authenticated(request, reply);
        if (!reply.sent) validCsrf(request, reply, config.DASHBOARD_SESSION_SECRET);
      },
    }, async (request, reply) => handler(request, reply));
  };

  get("/api/status", () => control.getStatus());
  get("/api/guilds", () => control.getGuilds());
  get("/api/commands", () => control.getCommands());
  get("/api/guilds/:guildId/permissions", async (request, reply) => {
    const guildId = getGuildId((request.params as { guildId: string }).guildId, reply);
    if (!guildId) return undefined;
    const user = sessionUser(request);
    return { administrator: user ? await isAdministrator(guildId, user.id) : false };
  });
  get("/api/guilds/:guildId/resolve", (request, reply) => {
    const guildId = getGuildId((request.params as { guildId: string }).guildId, reply);
    const query = resolveQuerySchema.safeParse(request.query);
    if (!query.success) {
      return Promise.resolve(apiError(reply, 400, "invalid_query", query.error.issues.map((issue) => issue.message).join("; ")));
    }
    return guildId ? control.resolve(guildId, query.data.q, query.data.kind) : Promise.resolve(undefined);
  });
  get("/api/guilds/:guildId/features", (request, reply) => {
    const guildId = getGuildId((request.params as { guildId: string }).guildId, reply);
    return guildId ? control.getFeatures(guildId) : Promise.resolve(undefined);
  });
  mutation("PATCH", "/api/guilds/:guildId/features/:featureId", async (request, reply) => {
    const params = request.params as { guildId: string; featureId: string };
    const guildId = getGuildId(params.guildId, reply);
    const featureId = getIdentifier(params.featureId, "Feature ID", reply);
    const body = featureSchema.safeParse(request.body);
    if (!body.success) return apiError(reply, 400, "invalid_body", "Feature state must include an enabled boolean.");
    if (!guildId || !featureId) return undefined;
    const user = await requireAdministrator(request, reply, guildId);
    return user ? control.updateFeature(guildId, featureId, body.data.enabled, user.id) : undefined;
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
      if (!guildId) return undefined;
      const action = request.params.action as MusicAction;
      const user = sessionUser(request);
      const userId = user && snowflakePattern.test(user.id) ? user.id : undefined;
      return control.musicAction(guildId, action, body.data, ["join", "play"].includes(action) ? userId : undefined);
    },
  );
  get("/api/guilds/:guildId/events", (request, reply) => {
    const guildId = getGuildId((request.params as { guildId: string }).guildId, reply);
    return guildId ? control.getScheduledEvents(guildId) : Promise.resolve(undefined);
  });
  post("/api/guilds/:guildId/events", async (request, reply) => {
    const guildId = getGuildId((request.params as { guildId: string }).guildId, reply);
    const body = scheduledEventCreateSchema.safeParse(request.body);
    if (!body.success) return apiError(reply, 400, "invalid_body", body.error.issues.map((issue) => issue.message).join("; "));
    if (!guildId) return undefined;
    const user = await requireAdministrator(request, reply, guildId);
    if (!user) return undefined;
    const payload: ScheduledEventPayload = { ...body.data, startAt: body.data.startAt.toISOString() };
    return control.createScheduledEvent(guildId, payload, user.id);
  });
  mutation("PATCH", "/api/guilds/:guildId/events/:eventId", async (request, reply) => {
    const params = request.params as { guildId: string; eventId: string };
    const guildId = getGuildId(params.guildId, reply);
    const eventId = getScheduledEventId(params.eventId, reply);
    const body = scheduledEventUpdateSchema.safeParse(request.body);
    if (!body.success) return apiError(reply, 400, "invalid_body", body.error.issues.map((issue) => issue.message).join("; "));
    if (!guildId || eventId === null) return undefined;
    const user = await requireAdministrator(request, reply, guildId);
    if (!user) return undefined;
    const { startAt, ...fields } = body.data;
    const payload: ScheduledEventUpdatePayload = { ...fields, ...(startAt ? { startAt: startAt.toISOString() } : {}) };
    return control.updateScheduledEvent(guildId, eventId, payload, user.id);
  });
  mutation("DELETE", "/api/guilds/:guildId/events/:eventId", async (request, reply) => {
    const params = request.params as { guildId: string; eventId: string };
    const guildId = getGuildId(params.guildId, reply);
    const eventId = getScheduledEventId(params.eventId, reply);
    if (!guildId || eventId === null) return undefined;
    const user = await requireAdministrator(request, reply, guildId);
    return user ? control.deleteScheduledEvent(guildId, eventId, user.id) : undefined;
  });
  post("/api/guilds/:guildId/events/:eventId/run", async (request, reply) => {
    const params = request.params as { guildId: string; eventId: string };
    const guildId = getGuildId(params.guildId, reply);
    const eventId = getScheduledEventId(params.eventId, reply);
    if (!guildId || eventId === null) return undefined;
    const user = await requireAdministrator(request, reply, guildId);
    return user ? control.runScheduledEvent(guildId, eventId, user.id) : undefined;
  });
  get("/api/guilds/:guildId/config", (request, reply) => {
    const guildId = getGuildId((request.params as { guildId: string }).guildId, reply);
    return guildId ? control.getConfig(guildId) : Promise.resolve(undefined);
  });
  mutation("PATCH", "/api/guilds/:guildId/config/:section", async (request, reply) => {
    const { guildId: rawGuildId, section } = request.params as { guildId: string; section: string };
    const guildId = getGuildId(rawGuildId, reply);
    if (!CONFIG_SECTIONS.includes(section as ConfigSection)) {
      return apiError(reply, 404, "unknown_config_section", "That settings section is not available.");
    }
    const body = bodySchema.safeParse(request.body);
    if (!body.success) return apiError(reply, 400, "invalid_body", "Settings must be a JSON object.");
    if (!guildId) return undefined;
    const user = await requireAdministrator(request, reply, guildId);
    return user ? control.patchConfig(guildId, section as ConfigSection, body.data, user.id) : undefined;
  });
  get("/api/guilds/:guildId/cah", (request, reply) => {
    const guildId = getGuildId((request.params as { guildId: string }).guildId, reply);
    return guildId ? control.cahState(guildId) : Promise.resolve(undefined);
  });
  post("/api/guilds/:guildId/cah/host", async (request, reply) => {
    const guildId = getGuildId((request.params as { guildId: string }).guildId, reply);
    const body = cahHostSchema.safeParse(request.body);
    if (!body.success) return apiError(reply, 400, "invalid_body", body.error.issues.map((issue) => issue.message).join("; "));
    if (!guildId) return undefined;
    const user = gameUser(request, reply);
    return user ? control.cahHost(guildId, body.data, user.id) : undefined;
  });
  post("/api/guilds/:guildId/cah/:action", async (request, reply) => {
    const params = request.params as { guildId: string; action: string };
    const guildId = getGuildId(params.guildId, reply);
    if (!CAH_ACTIONS.includes(params.action as CahAction)) {
      return apiError(reply, 404, "unknown_game_action", "That CAH action is not available.");
    }
    const body = cahActionSchema.safeParse(request.body);
    if (!body.success) return apiError(reply, 400, "invalid_body", body.error.issues.map((issue) => issue.message).join("; "));
    if (!guildId) return undefined;
    const user = gameUser(request, reply);
    return user ? control.cahAction(guildId, params.action as CahAction, body.data, user.id) : undefined;
  });
  get("/api/guilds/:guildId/tambola", (request, reply) => {
    const guildId = getGuildId((request.params as { guildId: string }).guildId, reply);
    return guildId ? control.tambolaState(guildId) : Promise.resolve(undefined);
  });
  post("/api/guilds/:guildId/tambola/:action", async (request, reply) => {
    const params = request.params as { guildId: string; action: string };
    const guildId = getGuildId(params.guildId, reply);
    if (!TAMBOLA_ACTIONS.includes(params.action as TambolaAction)) {
      return apiError(reply, 404, "unknown_game_action", "That Tambola action is not available.");
    }
    const body = tambolaActionSchema.safeParse(request.body);
    if (!body.success) return apiError(reply, 400, "invalid_body", body.error.issues.map((issue) => issue.message).join("; "));
    if (!guildId) return undefined;
    const user = gameUser(request, reply);
    return user ? control.tambolaAction(guildId, params.action as TambolaAction, body.data, user.id) : undefined;
  });
  get("/api/guilds/:guildId/casino", (request, reply) => {
    const guildId = getGuildId((request.params as { guildId: string }).guildId, reply);
    if (!guildId) return Promise.resolve(undefined);
    const user = gameUser(request, reply);
    return user ? control.casinoState(guildId, user.id) : Promise.resolve(undefined);
  });
  for (const game of CASINO_GAMES) {
    post(`/api/guilds/:guildId/casino/${game}`, async (request, reply) => {
      const guildId = getGuildId((request.params as { guildId: string }).guildId, reply);
      const schema = game === "coinflip" ? casinoCoinflipSchema : casinoSlotsSchema;
      const body = schema.safeParse(request.body);
      if (!body.success) return apiError(reply, 400, "invalid_body", body.error.issues.map((issue) => issue.message).join("; "));
      if (!guildId) return undefined;
      const user = gameUser(request, reply);
      return user ? control.casinoPlay(guildId, game as CasinoGame, body.data, user.id) : undefined;
    });
  }

  get("/api/guilds/:guildId/economy", (request, reply) => {
    const guildId = getGuildId((request.params as { guildId: string }).guildId, reply);
    if (!guildId) return Promise.resolve(undefined);
    const user = economyUser(request, reply);
    return user ? control.economyState(guildId, user.id) : Promise.resolve(undefined);
  });
  post("/api/guilds/:guildId/economy/:action", async (request, reply) => {
    const params = request.params as { guildId: string; action: string };
    const guildId = getGuildId(params.guildId, reply);
    if (!ECONOMY_ACTIONS.includes(params.action as EconomyAction)) {
      return apiError(reply, 404, "unknown_economy_action", "That economy action is not available.");
    }
    if (!guildId) return undefined;
    const user = economyUser(request, reply);
    return user ? control.economyAction(guildId, params.action as EconomyAction, user.id) : undefined;
  });
  get("/api/guilds/:guildId/leaderboard", (request, reply) => {
    const guildId = getGuildId((request.params as { guildId: string }).guildId, reply);
    if (!guildId) return Promise.resolve(undefined);
    const user = economyUser(request, reply);
    return user ? control.economyLeaderboard(guildId, user.id) : Promise.resolve(undefined);
  });
  get("/api/guilds/:guildId/stocks", (request, reply) => {
    const guildId = getGuildId((request.params as { guildId: string }).guildId, reply);
    if (!guildId) return Promise.resolve(undefined);
    const user = economyUser(request, reply);
    return user ? control.stockState(guildId, user.id) : Promise.resolve(undefined);
  });
  post("/api/guilds/:guildId/stocks/:action", async (request, reply) => {
    const params = request.params as { guildId: string; action: string };
    const guildId = getGuildId(params.guildId, reply);
    if (!STOCK_ACTIONS.includes(params.action as StockAction)) {
      return apiError(reply, 404, "unknown_stock_action", "That stock action is not available.");
    }
    const body = stockTradeSchema.safeParse(request.body);
    if (!body.success) return apiError(reply, 400, "invalid_body", body.error.issues.map((issue) => issue.message).join("; "));
    if (!guildId) return undefined;
    const user = economyUser(request, reply);
    return user ? control.stockTrade(guildId, params.action as StockAction, body.data, user.id) : undefined;
  });

  get("/api/guilds/:guildId/me/birthday", async (request, reply) => {
    const guildId = getGuildId((request.params as { guildId: string }).guildId, reply);
    if (!guildId) return undefined;
    const user = birthdayUser(request, reply);
    if (!user) return undefined;
    return { birthday: toBirthday(await control.getBirthday(guildId, user.id)) };
  });
  mutation("PUT", "/api/guilds/:guildId/me/birthday", async (request, reply) => {
    const guildId = getGuildId((request.params as { guildId: string }).guildId, reply);
    if (!guildId) return undefined;
    const user = birthdayUser(request, reply);
    if (!user) return undefined;
    const body = birthdaySchema.safeParse(request.body);
    if (!body.success) return apiError(reply, 400, "invalid_body", "Birthday must include month and day, with an optional year.");
    return { birthday: toBirthday(await control.setBirthday(guildId, user.id, body.data)) };
  });
  mutation("DELETE", "/api/guilds/:guildId/me/birthday", async (request, reply) => {
    const guildId = getGuildId((request.params as { guildId: string }).guildId, reply);
    if (!guildId) return undefined;
    const user = birthdayUser(request, reply);
    if (!user) return undefined;
    await control.clearBirthday(guildId, user.id);
    return { ok: true };
  });

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
    const extension = path.extname(fileReal).toLowerCase();
    const contentType = MIME_TYPES[extension] ?? "application/octet-stream";
    reply.header(
      "cache-control",
      [".html", ".js", ".css"].includes(extension) ? "no-store" : "public, max-age=3600",
    );
    return reply.type(contentType).send(content);
  } catch {
    return reply.code(404).send({ error: { code: "not_found", message: "Not found." } });
  }
}
