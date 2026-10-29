import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { FleetClient } from "./fleetClient.js";
import { UserError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";

const logger = { info: () => undefined, warn: () => undefined } as unknown as Logger;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("FleetClient", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const target = String(url);
        if (target.endsWith("/v1/music/play")) {
          const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          if (!("nodeId" in body)) {
            return jsonResponse({ nodeId: "voice-1", result: { added: 2, first: { title: "Song" } } });
          }
          return jsonResponse({ added: 1 }, 400);
        }
        throw new Error(`unexpected fetch: ${target}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("auto-routes without nodeId and returns the node", async () => {
    const client = new FleetClient("http://router:3100", "token-1234567890123456", logger);
    expect(client.enabled).toBe(true);
    const result = await client.autoPlay("song", "123");
    expect(result).toEqual({ nodeId: "voice-1", added: 2, title: "Song" });
  });

  it("maps fleet-full to a friendly error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: { code: "all_nodes_busy" } }, 429)),
    );
    const client = new FleetClient("http://router:3100", "token-1234567890123456", logger);
    await expect(client.autoPlay("song")).rejects.toBeInstanceOf(UserError);
  });

  it("sends the guild header on every request", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return jsonResponse({ nodeId: "voice-1", result: { added: 2, first: { title: "Song" } } });
      }),
    );
    const client = new FleetClient("http://router:3100", "token-1234567890123456", logger, "111111111111111111");
    await client.autoPlay("song", "123");
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers["x-guild-id"]).toBe("111111111111111111");
  });

  it("is disabled without a router URL", () => {
    expect(new FleetClient(null, "token-1234567890123456", logger).enabled).toBe(false);
  });
});
