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
    expect(calls[0]?.init.headers).toEqual({ authorization: "Bearer secret-control-token", "x-actor": "dashboard", "x-guild-id": "123" });
    expect(calls[1]?.init.headers).toEqual({ authorization: "Bearer secret-control-token", "x-actor": "dashboard", "x-guild-id": "123", "content-type": "application/json" });
    expect(calls[1]?.init.body).toBe(JSON.stringify({ featureId: "music-playback", enabled: false }));
  });

  it("sends the user scope and the acting user for identity and birthday routes", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = vi.fn(async (input: URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return Response.json({ administrator: true, user: { id: "456789012345678901", name: "Ada" } });
    });
    const client = createControlClient("http://bot-control:3001", "secret-control-token", fetcher);
    const user = "456789012345678901";

    await client.authorize("123", user);
    await client.getBirthday("123", user);
    await client.setBirthday("123", user, { month: 4, day: 2 });
    await client.clearBirthday("123", user);
    await client.updateFeature("123", "music-playback", true, user);

    expect(calls.map(({ url, init }) => [url, init.method])).toEqual([
      ["http://bot-control:3001/v1/authorize", "GET"],
      ["http://bot-control:3001/v1/users/me/birthday", "GET"],
      ["http://bot-control:3001/v1/users/me/birthday", "PUT"],
      ["http://bot-control:3001/v1/users/me/birthday", "DELETE"],
      ["http://bot-control:3001/v1/features", "PATCH"],
    ]);
    expect(calls[0]?.init.headers).toEqual({
      authorization: "Bearer secret-control-token",
      "x-actor": "dashboard",
      "x-guild-id": "123",
      "x-user-id": user,
    });
    expect(calls[4]?.init.headers).toMatchObject({ "x-actor": user });
    expect(calls[2]?.init.body).toBe(JSON.stringify({ month: 4, day: 2 }));
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

describe("control API game routes", () => {
  it("scopes game reads to the guild and game actions to the signed-in user", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = vi.fn(async (input: URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return Response.json({ enabled: true, game: null });
    });
    const client = createControlClient("http://bot-control:3001", "secret-control-token", fetcher);
    const user = "456789012345678901";

    await client.cahState("123");
    await client.cahHost("123", { channelId: "333333333333333333" }, user);
    await client.cahAction("123", "reveal", { gameId: "ABC123", roundIndex: 2 }, user);
    await client.tambolaState("123");
    await client.tambolaAction("123", "end", { gameId: "TMB123" }, user);
    await client.casinoState("123", user);
    await client.casinoPlay("123", "coinflip", { bet: 50, side: "heads", requestId: "request-1234" }, user);

    expect(calls.map(({ url, init }) => [url, init.method])).toEqual([
      ["http://bot-control:3001/v1/cah/state", "GET"],
      ["http://bot-control:3001/v1/cah/host", "POST"],
      ["http://bot-control:3001/v1/cah/reveal", "POST"],
      ["http://bot-control:3001/v1/tambola/state", "GET"],
      ["http://bot-control:3001/v1/tambola/end", "POST"],
      ["http://bot-control:3001/v1/casino/state", "GET"],
      ["http://bot-control:3001/v1/casino/coinflip", "POST"],
    ]);
    expect(calls[0]?.init.headers).toEqual({
      authorization: "Bearer secret-control-token",
      "x-actor": "dashboard",
      "x-guild-id": "123",
    });
    expect(calls[1]?.init.headers).toEqual({
      authorization: "Bearer secret-control-token",
      "x-actor": user,
      "x-guild-id": "123",
      "x-user-id": user,
      "content-type": "application/json",
    });
    expect(calls[5]?.init.headers).toMatchObject({ "x-user-id": user });
    expect(calls[6]?.init.body).toBe(JSON.stringify({ bet: 50, side: "heads", requestId: "request-1234" }));
  });
});
