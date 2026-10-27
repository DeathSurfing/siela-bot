import type { Logger } from "../lib/logger.js";
import { UserError } from "../lib/errors.js";
import type { MusicQueueState } from "@siela/shared";

export interface FleetPlayResult {
  nodeId: string;
  added: number;
  title: string;
}

/**
 * Commander-side fleet client. When the commander's own voice is locked
 * (Tambola, TTS), `/play` falls back to a free fleet node via the router
 * instead of failing. The router auto-routes and 429s when full.
 */
export interface FleetNodePlayback {
  state: MusicQueueState | null;
  channelId: string | null;
}

export class FleetClient {
  constructor(
    private readonly routerUrl: string | null,
    private readonly token: string,
    private readonly logger: Logger,
  ) {}

  get enabled(): boolean {
    return Boolean(this.routerUrl);
  }

  private base(): string {
    if (!this.routerUrl) throw new UserError("The voice fleet is not configured.");
    return this.routerUrl.replace(/\/+$/, "");
  }

  private auth(): Record<string, string> {
    return { "content-type": "application/json", authorization: `Bearer ${this.token}` };
  }

  /** Live playback state (plus voice channel) of one fleet node. */
  async nodeState(nodeId: string): Promise<FleetNodePlayback> {
    let response: Response;
    try {
      response = await fetch(`${this.base()}/v1/music/state?nodeId=${encodeURIComponent(nodeId)}`, {
        headers: { authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      this.logger.warn({ err: error, nodeId }, "fleet node unreachable");
      throw new UserError("That voice node is unreachable.");
    }
    const parsed = (await response.json().catch(() => null)) as (MusicQueueState & { channelId?: unknown }) | null;
    if (!response.ok || !parsed || typeof parsed !== "object") {
      throw new UserError("That voice node is unreachable.");
    }
    return {
      state: {
        playing: parsed.playing === true,
        paused: parsed.paused === true,
        volume: typeof parsed.volume === "number" ? parsed.volume : 80,
        loop: parsed.loop === "track" || parsed.loop === "queue" ? parsed.loop : "off",
        position: typeof parsed.position === "number" ? parsed.position : 0,
        current: (parsed.current ?? null) as MusicQueueState["current"],
        upcoming: Array.isArray(parsed.upcoming) ? parsed.upcoming : [],
      },
      channelId: typeof parsed.channelId === "string" ? parsed.channelId : null,
    };
  }

  /** Forward one music op to a fleet node (nodeId always attached). */
  async control(nodeId: string, op: string, body: Record<string, unknown> = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.base()}/v1/music/${op}`, {
        method: "POST",
        headers: this.auth(),
        body: JSON.stringify({ ...body, nodeId }),
        signal: AbortSignal.timeout(op === "play" ? 300_000 : 30_000),
      });
    } catch (error) {
      this.logger.warn({ err: error, nodeId, op }, "fleet control unreachable");
      throw new UserError("That voice node is unreachable.");
    }
    const parsed = (await response.json().catch(() => null)) as { error?: { message?: unknown } } | null;
    if (!response.ok) {
      const message = typeof parsed?.error?.message === "string" ? parsed.error.message : "That fleet control failed.";
      throw new UserError(message);
    }
    return parsed;
  }

  /** Enable TTS on a free fleet node (auto-routed). Returns the node. */
  async ttsEnable(channelId: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${this.base()}/v1/tts/enable`, {
        method: "POST",
        headers: this.auth(),
        body: JSON.stringify({ channelId }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      this.logger.warn({ err: error }, "fleet tts unreachable");
      throw new UserError("No voice nodes are reachable. Try again in a moment.");
    }
    const parsed = (await response.json().catch(() => null)) as { nodeId?: unknown; error?: { message?: unknown } } | null;
    if (!response.ok) {
      if (response.status === 429) {
        throw new UserError("All voice nodes are busy. Add more worker nodes for more concurrent streams.");
      }
      const message = typeof parsed?.error?.message === "string" ? parsed.error.message : "Fleet TTS failed.";
      throw new UserError(message);
    }
    if (typeof parsed?.nodeId !== "string") throw new UserError("Fleet TTS returned an unexpected response.");
    return parsed.nodeId;
  }

  async ttsDisable(nodeId: string): Promise<void> {
    await this.controlTts(nodeId, "disable", {});
  }

  async ttsSpeak(nodeId: string, utterance: string, speakerId?: string): Promise<void> {
    await this.controlTts(nodeId, "speak", { utterance, speakerId });
  }

  private async controlTts(nodeId: string, op: string, body: Record<string, unknown>): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${this.base()}/v1/tts/${op}`, {
        method: "POST",
        headers: this.auth(),
        body: JSON.stringify({ ...body, nodeId }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      this.logger.warn({ err: error, nodeId, op }, "fleet tts unreachable");
      throw new UserError("That voice node is unreachable.");
    }
    if (!response.ok) {
      const parsed = (await response.json().catch(() => null)) as { error?: { message?: unknown } } | null;
      const message = typeof parsed?.error?.message === "string" ? parsed.error.message : "Fleet TTS failed.";
      throw new UserError(message);
    }
  }

  async autoPlay(query: string, voiceChannelId?: string, next = false): Promise<FleetPlayResult> {
    if (!this.routerUrl) throw new UserError("The voice fleet is not configured.");
    let response: Response;
    try {
      response = await fetch(`${this.routerUrl.replace(/\/+$/, "")}/v1/music/play`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ query, voiceChannelId, next }),
        signal: AbortSignal.timeout(300_000),
      });
    } catch (error) {
      this.logger.warn({ err: error }, "fleet auto-route unreachable");
      throw new UserError("No voice nodes are reachable. Try again in a moment.");
    }
    const parsed = (await response.json().catch(() => null)) as {
      nodeId?: unknown;
      result?: { added?: unknown; first?: { title?: unknown } };
      error?: { code?: unknown; message?: unknown };
    } | null;
    if (!response.ok) {
      if (response.status === 429) {
        throw new UserError("All voice nodes are busy. Add more worker nodes for more concurrent streams.");
      }
      const message = typeof parsed?.error?.message === "string" ? parsed.error.message : "Fleet playback failed.";
      throw new UserError(message);
    }
    if (typeof parsed?.nodeId !== "string" || typeof parsed?.result?.added !== "number") {
      throw new UserError("Fleet playback returned an unexpected response.");
    }
    return {
      nodeId: parsed.nodeId,
      added: parsed.result.added,
      title: typeof parsed.result.first?.title === "string" ? parsed.result.first.title : "Unknown title",
    };
  }
}
