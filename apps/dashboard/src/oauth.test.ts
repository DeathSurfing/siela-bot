import { describe, expect, it, vi } from "vitest";
import { createDiscordOAuth, DiscordOAuthError, isOAuthOwner } from "./oauth.js";

const oauth = {
  clientId: "111111111111111111",
  clientSecret: "a-long-discord-client-secret",
  redirectUri: "http://localhost:3000/auth/discord/callback",
  ownerIds: ["111111111111111111"],
};

function fetcher(responses: Record<string, Response>): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const response = responses[url];
    if (!response) throw new Error(`unexpected fetch ${url}`);
    return response;
  }) as unknown as typeof fetch;
}

describe("Discord OAuth", () => {
  it("builds an identify authorize URL with the state and redirect", () => {
    const url = new URL(createDiscordOAuth(oauth).authorizeUrl("state-value"));
    expect(url.origin + url.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe(oauth.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(oauth.redirectUri);
    expect(url.searchParams.get("scope")).toBe("identify");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("exchanges a code and maps the Discord user", async () => {
    const client = createDiscordOAuth(
      oauth,
      fetcher({
        "https://discord.com/api/oauth2/token": Response.json({ access_token: "token-value" }),
        "https://discord.com/api/users/@me": Response.json({
          id: "111111111111111111",
          username: "owner",
          global_name: "Owner",
          avatar: "abc",
        }),
      }),
    );
    const user = await client.exchange("code-value");
    expect(user).toEqual({
      id: "111111111111111111",
      name: "Owner",
      avatarUrl: "https://cdn.discordapp.com/avatars/111111111111111111/abc.png?size=64",
    });
    expect(isOAuthOwner(oauth, user)).toBe(true);
  });

  it("rejects a failed token exchange", async () => {
    const client = createDiscordOAuth(
      oauth,
      fetcher({ "https://discord.com/api/oauth2/token": Response.json({ error: "invalid_grant" }, { status: 400 }) }),
    );
    await expect(client.exchange("code-value")).rejects.toBeInstanceOf(DiscordOAuthError);
  });
});
