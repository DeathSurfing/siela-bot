import type { Logger } from "../lib/logger.js";
import { UserError } from "../lib/errors.js";

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
export class FleetClient {
  constructor(
    private readonly routerUrl: string | null,
    private readonly token: string,
    private readonly logger: Logger,
  ) {}

  get enabled(): boolean {
    return Boolean(this.routerUrl);
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
        throw new UserError("All voice nodes are busy right now. Try again when one frees up.");
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
