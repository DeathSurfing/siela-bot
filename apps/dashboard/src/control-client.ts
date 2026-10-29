export const MUSIC_ACTIONS = [
  "join", "play", "pause", "resume", "skip", "stop", "volume", "seek", "loop", "shuffle", "clear", "disconnect",
] as const;

export const CONFIG_SECTIONS = ["prefix", "welcome", "autorole", "tempvc", "music"] as const;

export type MusicAction = (typeof MUSIC_ACTIONS)[number];
export type ConfigSection = (typeof CONFIG_SECTIONS)[number];

export class ControlApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface ControlClient {
  getStatus(): Promise<unknown>;
  getGuilds(): Promise<unknown>;
  getFeatures(guildId: string): Promise<unknown>;
  updateFeature(guildId: string, featureId: string, enabled: boolean): Promise<unknown>;
  getAudit(guildId: string, limit: number): Promise<unknown>;
  getMusic(guildId: string): Promise<unknown>;
  musicAction(guildId: string, action: MusicAction, body: unknown): Promise<unknown>;
  getConfig(guildId: string): Promise<unknown>;
  patchConfig(guildId: string, section: ConfigSection, body: Record<string, unknown>): Promise<unknown>;
  getCommands(): Promise<unknown>;
}

type ControlFetch = (url: URL, init?: RequestInit) => Promise<Response>;

export function createControlClient(baseUrl: string, token: string, fetcher: ControlFetch = fetch): ControlClient {
  async function request(path: string, options: { guildId?: string; method?: string; body?: unknown } = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(new URL(path, baseUrl), {
        method: options.method ?? "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-actor": "dashboard",
          ...(options.guildId ? { "x-guild-id": options.guildId } : {}),
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
    getFeatures: (guildId) => request("/v1/features", { guildId }),
    updateFeature: (guildId, featureId, enabled) => request("/v1/features", { guildId, method: "PATCH", body: { featureId, enabled } }),
    getAudit: (guildId, limit) => request(`/v1/audit?limit=${encodeURIComponent(String(limit))}`, { guildId }),
    getMusic: (guildId) => request("/v1/music/state", { guildId }),
    musicAction: (guildId, action, body) => request(`/v1/music/${action}`, { guildId, method: "POST", body }),
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
    patchConfig: (guildId, section, body) => {
      const paths: Record<ConfigSection, string> = {
        prefix: "/v1/prefix",
        welcome: "/v1/welcome",
        autorole: "/v1/autorole",
        tempvc: "/v1/tempvc/config",
        music: "/v1/music/config",
      };
      return request(paths[section], { guildId, method: "PATCH", body });
    },
    getCommands: () => request("/v1/commands"),
  };
}
