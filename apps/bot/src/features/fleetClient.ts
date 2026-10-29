import type { Logger } from "../lib/logger.js";
import { UserError } from "../lib/errors.js";
import type { MusicQueueState } from "@siela/shared";

export interface FleetPlayResult {
  nodeId: string;
  added: number;
  title: string;
}

const FULL_MESSAGE = "All voice nodes are busy. Add more worker nodes for more concurrent streams.";

/**
 * Commander-side fleet client. When the commander's own voice is locked
 * (Tambola, TTS), `/play` falls back to a free fleet node via the router
 * instead of failing. The router auto-routes and 429s when full.
 */
export interface FleetNodePlayback {
  state: MusicQueueState | null;
  channelId: string | null;
}

interface RouterErrorBody {
  error?: { message?: unknown; code?: unknown };
}

export class FleetClient {
  constructor(
    private readonly routerUrl: string | null,
    private readonly token: string,
    private readonly logger: Logger,
    /** Guild every request targets. The router and workers scope by this. */
    private readonly guildId: string | null = null,
  ) {}

  get enabled(): boolean {
    return Boolean(this.routerUrl);
  }

  private base(): string {
    if (!this.routerUrl) throw new UserError("The voice fleet is not configured.");
    return this.routerUrl.replace(/\/+$/, "");
  }

  private auth(): Record<string, string> {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${this.token}`,
      ...(this.guildId ? { "x-guild-id": this.guildId } : {}),
    };
  }

  private async request(
    method: string,
    path: string,
    body: unknown,
    timeoutMs: number,
    logContext: Record<string, unknown>,
    unreachableMessage: string,
  ): Promise<{ status: number; parsed: unknown }> {
    let response: Response;
    try {
      response = await fetch(`${this.base()}${path}`, {
        method,
        headers: method === "GET"
          ? {
              authorization: `Bearer ${this.token}`,
              ...(this.guildId ? { "x-guild-id": this.guildId } : {}),
            }
          : this.auth(),
        body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      this.logger.warn({ err: error, ...logContext }, "fleet request unreachable");
      throw new UserError(unreachableMessage);
    }
    const parsed: unknown = await response.json().catch(() => null);
    return { status: response.status, parsed };
  }

  private errorMessage(parsed: unknown, fallback: string): string {
    const message = (parsed as RouterErrorBody | null)?.error?.message;
    return typeof message === "string" ? message : fallback;
  }

  private errorCode(parsed: unknown): string {
    const code = (parsed as RouterErrorBody | null)?.error?.code;
    return typeof code === "string" ? code : "user_error";
  }

  private throwForStatus(
    status: number,
    parsed: unknown,
    fallback: string,
    logContext: Record<string, unknown>,
  ): never {
    if (status === 429) throw new UserError(FULL_MESSAGE, "all_nodes_busy");
    this.logger.debug({ status, ...logContext }, "fleet request failed");
    throw new UserError(this.errorMessage(parsed, fallback), this.errorCode(parsed));
  }

  /** Live playback state (plus voice channel) of one fleet node. */
  async nodeState(nodeId: string): Promise<FleetNodePlayback> {
    const { status, parsed } = await this.request(
      "GET",
      `/v1/music/state?nodeId=${encodeURIComponent(nodeId)}`,
      undefined,
      15_000,
      { nodeId },
      "That voice node is unreachable.",
    );
    const state = parsed as (MusicQueueState & { channelId?: unknown }) | null;
    if (status !== 200 || !state || typeof state !== "object") {
      throw new UserError("That voice node is unreachable.");
    }
    return {
      state: {
        playing: state.playing === true,
        paused: state.paused === true,
        volume: typeof state.volume === "number" ? state.volume : 80,
        loop: state.loop === "track" || state.loop === "queue" ? state.loop : "off",
        position: typeof state.position === "number" ? state.position : 0,
        current: (state.current ?? null) as MusicQueueState["current"],
        upcoming: Array.isArray(state.upcoming) ? state.upcoming : [],
      },
      channelId: typeof state.channelId === "string" ? state.channelId : null,
    };
  }

  /** Forward one music op to a fleet node (nodeId always attached). */
  async control(nodeId: string, op: string, body: Record<string, unknown> = {}): Promise<unknown> {
    const { status, parsed } = await this.request(
      "POST",
      `/v1/music/${op}`,
      { ...body, nodeId },
      op === "play" ? 300_000 : 30_000,
      { nodeId, op },
      "That voice node is unreachable.",
    );
    if (status !== 200) {
      this.throwForStatus(status, parsed, "That fleet control failed.", { nodeId, op });
    }
    return parsed;
  }

  /** Enable TTS on a free fleet node (auto-routed). Returns the node. */
  async ttsEnable(channelId: string): Promise<string> {
    const { status, parsed } = await this.request(
      "POST",
      "/v1/tts/enable",
      { channelId },
      30_000,
      {},
      "No voice nodes are reachable. Try again in a moment.",
    );
    if (status !== 200) {
      this.throwForStatus(status, parsed, "Fleet TTS failed.", {});
    }
    const nodeId = (parsed as { nodeId?: unknown } | null)?.nodeId;
    if (typeof nodeId !== "string") throw new UserError("Fleet TTS returned an unexpected response.");
    return nodeId;
  }

  async ttsDisable(nodeId: string): Promise<void> {
    await this.ttsControl(nodeId, "disable", {});
  }

  async ttsSpeak(nodeId: string, utterance: string, speakerId?: string): Promise<void> {
    await this.ttsControl(nodeId, "speak", { utterance, speakerId });
  }

  private async ttsControl(nodeId: string, op: string, body: Record<string, unknown>): Promise<void> {
    const { status, parsed } = await this.request(
      "POST",
      `/v1/tts/${op}`,
      { ...body, nodeId },
      30_000,
      { nodeId, op },
      "That voice node is unreachable.",
    );
    if (status !== 200) {
      this.throwForStatus(status, parsed, "Fleet TTS failed.", { nodeId, op });
    }
  }

  async autoPlay(query: string, voiceChannelId?: string, next = false): Promise<FleetPlayResult> {
    const { status, parsed } = await this.request(
      "POST",
      "/v1/music/play",
      { query, voiceChannelId, next },
      300_000,
      {},
      "No voice nodes are reachable. Try again in a moment.",
    );
    const result = parsed as {
      nodeId?: unknown;
      result?: { added?: unknown; first?: { title?: unknown } };
    } | null;
    if (status !== 200) {
      this.throwForStatus(status, parsed, "Fleet playback failed.", {});
    }
    if (typeof result?.nodeId !== "string" || typeof result?.result?.added !== "number") {
      throw new UserError("Fleet playback returned an unexpected response.");
    }
    return {
      nodeId: result.nodeId,
      added: result.result.added,
      title: typeof result.result.first?.title === "string" ? result.result.first.title : "Unknown title",
    };
  }
}
