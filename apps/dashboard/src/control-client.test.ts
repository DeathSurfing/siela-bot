import { describe, expect, it, vi } from "vitest";
import { createControlClient } from "./control-client.js";

describe("control API client", () => {
  it("sends the bearer token and guild scope for feature reads and writes", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = vi.fn(async (input: URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return Response.json({ guildId: "123", features: [] });
    });
    const client = createControlClient("http://bot-control:3001", "secret-control-token", fetcher);

    await client.getFeatures("123");
    await client.updateFeature("123", "music-playback", false);

    expect(calls.map(({ url }) => url)).toEqual([
      "http://bot-control:3001/v1/features",
      "http://bot-control:3001/v1/features",
    ]);
    expect(calls[0]?.init.headers).toEqual({ authorization: "Bearer secret-control-token", "x-guild-id": "123" });
    expect(calls[1]?.init.headers).toEqual({ authorization: "Bearer secret-control-token", "x-guild-id": "123", "content-type": "application/json" });
    expect(calls[1]?.init.body).toBe(JSON.stringify({ featureId: "music-playback", enabled: false }));
  });

  it("turns a control API 401 into a distinct token error", async () => {
    const client = createControlClient("http://bot-control:3001", "wrong-token", async () =>
      Response.json({ error: { code: "unauthorized", message: "Invalid token" } }, { status: 401 }),
    );

    await expect(client.getStatus()).rejects.toMatchObject({
      message: "The dashboard token is wrong. Check MCP_TOKEN.",
      code: "control_unauthorized",
      statusCode: 502,
    });
  });
});
