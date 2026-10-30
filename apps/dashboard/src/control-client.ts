export const MUSIC_ACTIONS = [
  "join", "play", "pause", "resume", "skip", "stop", "seek", "loop", "shuffle", "clear", "filters", "disconnect",
] as const;

export const CONFIG_SECTIONS = ["prefix", "welcome", "autorole", "tempvc", "music"] as const;
export const CAH_ACTIONS = ["start", "reveal", "next", "end"] as const;
export const TAMBOLA_ACTIONS = ["end", "pause", "resume"] as const;
export const CASINO_GAMES = ["coinflip", "slots"] as const;
export const ECONOMY_ACTIONS = ["daily", "work"] as const;
export const STOCK_ACTIONS = ["buy", "sell"] as const;
export const RESOLVE_KINDS = ["channel", "voice", "role", "user"] as const;

export type MusicAction = (typeof MUSIC_ACTIONS)[number];
export type ConfigSection = (typeof CONFIG_SECTIONS)[number];
export type CahAction = (typeof CAH_ACTIONS)[number];
export type TambolaAction = (typeof TAMBOLA_ACTIONS)[number];
export type CasinoGame = (typeof CASINO_GAMES)[number];
export type EconomyAction = (typeof ECONOMY_ACTIONS)[number];
export type StockAction = (typeof STOCK_ACTIONS)[number];
export type ResolveKind = (typeof RESOLVE_KINDS)[number];

export class ControlApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface AuthorizationResult {
  administrator: boolean;
  user: { id: string; name: string } | null;
}

export interface BirthdayInput {
  month: number;
  day: number;
  year?: number | null;
}

export interface ScheduledEventPayload {
  name: string;
  channelId: string;
  sourceUrl: string;
  startAt: string;
  repeat: "none" | "daily" | "weekly";
  enabled: boolean;
}

export type ScheduledEventUpdatePayload = Partial<ScheduledEventPayload>;

export interface ControlClient {
  getStatus(): Promise<unknown>;
  getGuilds(): Promise<unknown>;
  resolve(guildId: string, query: string, kind?: ResolveKind): Promise<unknown>;
  getFeatures(guildId: string): Promise<unknown>;
  updateFeature(guildId: string, featureId: string, enabled: boolean, actorId?: string): Promise<unknown>;
  getAudit(guildId: string, limit: number): Promise<unknown>;
  getMusic(guildId: string): Promise<unknown>;
  musicAction(guildId: string, action: MusicAction, body: unknown, userId?: string): Promise<unknown>;
  getScheduledEvents(guildId: string): Promise<unknown>;
  createScheduledEvent(guildId: string, body: ScheduledEventPayload, userId: string): Promise<unknown>;
  updateScheduledEvent(guildId: string, eventId: number, body: ScheduledEventUpdatePayload, userId: string): Promise<unknown>;
  deleteScheduledEvent(guildId: string, eventId: number, userId: string): Promise<unknown>;
  runScheduledEvent(guildId: string, eventId: number, userId: string): Promise<unknown>;
  getConfig(guildId: string): Promise<unknown>;
  patchConfig(guildId: string, section: ConfigSection, body: Record<string, unknown>, actorId?: string): Promise<unknown>;
  getCommands(): Promise<unknown>;
  authorize(guildId: string, userId: string): Promise<AuthorizationResult>;
  getBirthday(guildId: string, userId: string): Promise<unknown>;
  setBirthday(guildId: string, userId: string, body: BirthdayInput): Promise<unknown>;
  clearBirthday(guildId: string, userId: string): Promise<unknown>;
  cahState(guildId: string): Promise<unknown>;
  cahHost(guildId: string, body: Record<string, unknown>, userId: string): Promise<unknown>;
  cahAction(guildId: string, action: CahAction, body: Record<string, unknown>, userId: string): Promise<unknown>;
  tambolaState(guildId: string): Promise<unknown>;
  tambolaAction(guildId: string, action: TambolaAction, body: Record<string, unknown>, userId: string): Promise<unknown>;
  casinoState(guildId: string, userId: string): Promise<unknown>;
  casinoPlay(guildId: string, game: CasinoGame, body: Record<string, unknown>, userId: string): Promise<unknown>;
  economyState(guildId: string, userId: string): Promise<unknown>;
  economyAction(guildId: string, action: EconomyAction, userId: string): Promise<unknown>;
  economyLeaderboard(guildId: string, userId: string): Promise<unknown>;
  stockState(guildId: string, userId: string): Promise<unknown>;
  stockTrade(guildId: string, action: StockAction, body: Record<string, unknown>, userId: string): Promise<unknown>;
}

type ControlFetch = (url: URL, init?: RequestInit) => Promise<Response>;

export function createControlClient(baseUrl: string, token: string, fetcher: ControlFetch = fetch): ControlClient {
  async function request(
    path: string,
    options: { guildId?: string; userId?: string; actorId?: string; method?: string; body?: unknown } = {},
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(new URL(path, baseUrl), {
        method: options.method ?? "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-actor": options.actorId ?? "dashboard",
          ...(options.guildId ? { "x-guild-id": options.guildId } : {}),
          ...(options.userId ? { "x-user-id": options.userId } : {}),
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ControlApiError("Control API unreachable. Check the bot control service and network.", 503, "control_unreachable");
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "error" in payload && payload.error && typeof payload.error === "object" && "message" in payload.error
          ? String(payload.error.message)
          : `Control API returned ${response.status}.`;
      if (response.status === 401) {
        throw new ControlApiError("The dashboard token is wrong. Check MCP_TOKEN.", 502, "control_unauthorized");
      }
      throw new ControlApiError(message, response.status, "control_error");
    }
    return payload;
  }

  return {
    getStatus: () => request("/v1/status"),
    getGuilds: () => request("/v1/guilds"),
    resolve: (guildId, query, kind) => {
      const params = new URLSearchParams({ q: query });
      if (kind) params.set("kind", kind);
      return request(`/v1/resolve?${params.toString()}`, { guildId });
    },
    getFeatures: (guildId) => request("/v1/features", { guildId }),
    updateFeature: (guildId, featureId, enabled, actorId) =>
      request("/v1/features", { guildId, actorId, method: "PATCH", body: { featureId, enabled } }),
    getAudit: (guildId, limit) => request(`/v1/audit?limit=${encodeURIComponent(String(limit))}`, { guildId }),
    getMusic: (guildId) => request("/v1/music/state", { guildId }),
    musicAction: (guildId, action, body, userId) =>
      request(`/v1/music/${action}`, { guildId, userId, actorId: userId, method: "POST", body }),
    getScheduledEvents: (guildId) => request("/v1/events", { guildId }),
    createScheduledEvent: (guildId, body, userId) =>
      request("/v1/events", { guildId, userId, actorId: userId, method: "POST", body }),
    updateScheduledEvent: (guildId, eventId, body, userId) =>
      request(`/v1/events/${eventId}`, { guildId, userId, actorId: userId, method: "PATCH", body }),
    deleteScheduledEvent: (guildId, eventId, userId) =>
      request(`/v1/events/${eventId}`, { guildId, userId, actorId: userId, method: "DELETE" }),
    runScheduledEvent: (guildId, eventId, userId) =>
      request(`/v1/events/${eventId}/run`, { guildId, userId, actorId: userId, method: "POST" }),
    getConfig: async (guildId) => {
      const [prefix, welcome, autorole, tempvc, music] = await Promise.all([
        request("/v1/prefix", { guildId }),
        request("/v1/welcome", { guildId }),
        request("/v1/autorole", { guildId }),
        request("/v1/tempvc/config", { guildId }),
        request("/v1/music/config", { guildId }),
      ]);
      return { prefix, welcome, autorole, tempvc, music };
    },
    patchConfig: (guildId, section, body, actorId) => {
      const paths: Record<ConfigSection, string> = {
        prefix: "/v1/prefix",
        welcome: "/v1/welcome",
        autorole: "/v1/autorole",
        tempvc: "/v1/tempvc/config",
        music: "/v1/music/config",
      };
      return request(paths[section], { guildId, actorId, method: "PATCH", body });
    },
    getCommands: () => request("/v1/commands"),
    authorize: (guildId, userId) =>
      request("/v1/authorize", { guildId, userId }) as Promise<AuthorizationResult>,
    getBirthday: (guildId, userId) => request("/v1/users/me/birthday", { guildId, userId }),
    setBirthday: (guildId, userId, body) =>
      request("/v1/users/me/birthday", { guildId, userId, method: "PUT", body }),
    clearBirthday: (guildId, userId) =>
      request("/v1/users/me/birthday", { guildId, userId, method: "DELETE" }),
    cahState: (guildId) => request("/v1/cah/state", { guildId }),
    cahHost: (guildId, body, userId) =>
      request("/v1/cah/host", { guildId, userId, actorId: userId, method: "POST", body }),
    cahAction: (guildId, action, body, userId) =>
      request(`/v1/cah/${action}`, { guildId, userId, actorId: userId, method: "POST", body }),
    tambolaState: (guildId) => request("/v1/tambola/state", { guildId }),
    tambolaAction: (guildId, action, body, userId) =>
      request(`/v1/tambola/${action}`, { guildId, userId, actorId: userId, method: "POST", body }),
    casinoState: (guildId, userId) => request("/v1/casino/state", { guildId, userId }),
    casinoPlay: (guildId, game, body, userId) =>
      request(`/v1/casino/${game}`, { guildId, userId, actorId: userId, method: "POST", body }),
    economyState: (guildId, userId) => request("/v1/economy/state", { guildId, userId }),
    economyAction: (guildId, action, userId) =>
      request(`/v1/economy/${action}`, { guildId, userId, actorId: userId, method: "POST", body: {} }),
    economyLeaderboard: (guildId, userId) => request("/v1/economy/leaderboard?limit=25", { guildId, userId }),
    stockState: (guildId, userId) => request("/v1/stocks/state", { guildId, userId }),
    stockTrade: (guildId, action, body, userId) =>
      request(`/v1/stocks/${action}`, { guildId, userId, actorId: userId, method: "POST", body }),
  };
}
