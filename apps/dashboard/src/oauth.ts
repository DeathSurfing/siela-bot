import { randomBytes } from "node:crypto";
import type { DashboardOAuthConfig } from "./config.js";
import type { SessionUser } from "./session.js";

const AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const TOKEN_URL = "https://discord.com/api/oauth2/token";
const USER_URL = "https://discord.com/api/users/@me";
const REQUEST_TIMEOUT_MS = 10_000;

export class DiscordOAuthError extends Error {
  constructor(readonly code: "token_exchange_failed" | "user_fetch_failed" | "invalid_response") {
    super("Discord sign-in failed.");
    this.name = "DiscordOAuthError";
  }
}

export interface DiscordOAuth {
  authorizeUrl(state: string): string;
  exchange(code: string): Promise<SessionUser>;
}

interface DiscordTokenResponse {
  access_token?: unknown;
}

interface DiscordUserResponse {
  id?: unknown;
  username?: unknown;
  global_name?: unknown;
  avatar?: unknown;
}

function avatarUrl(id: string, hash: string | null): string | null {
  return hash ? `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=64` : null;
}

export function createDiscordOAuth(
  oauth: DashboardOAuthConfig,
  fetchImpl: typeof fetch = fetch,
): DiscordOAuth {
  return {
    authorizeUrl(state: string): string {
      const url = new URL(AUTHORIZE_URL);
      url.searchParams.set("client_id", oauth.clientId);
      url.searchParams.set("redirect_uri", oauth.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "identify");
      url.searchParams.set("state", state);
      return url.toString();
    },

    async exchange(code: string): Promise<SessionUser> {
      let tokenResponse: Response;
      try {
        tokenResponse = await fetchImpl(TOKEN_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: oauth.clientId,
            client_secret: oauth.clientSecret,
            grant_type: "authorization_code",
            code,
            redirect_uri: oauth.redirectUri,
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        throw new DiscordOAuthError("token_exchange_failed");
      }
      if (!tokenResponse.ok) throw new DiscordOAuthError("token_exchange_failed");
      const token = (await tokenResponse.json().catch(() => null)) as DiscordTokenResponse | null;
      if (!token || typeof token.access_token !== "string") throw new DiscordOAuthError("invalid_response");

      let userResponse: Response;
      try {
        userResponse = await fetchImpl(USER_URL, {
          headers: { authorization: `Bearer ${token.access_token}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        throw new DiscordOAuthError("user_fetch_failed");
      }
      if (!userResponse.ok) throw new DiscordOAuthError("user_fetch_failed");
      const user = (await userResponse.json().catch(() => null)) as DiscordUserResponse | null;
      if (!user || typeof user.id !== "string" || typeof user.username !== "string") {
        throw new DiscordOAuthError("invalid_response");
      }
      return {
        id: user.id,
        name: typeof user.global_name === "string" && user.global_name ? user.global_name : user.username,
        avatarUrl: typeof user.avatar === "string" ? avatarUrl(user.id, user.avatar) : null,
      };
    },
  };
}

export function createOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function isOAuthOwner(oauth: DashboardOAuthConfig, user: SessionUser): boolean {
  return oauth.ownerIds.includes(user.id);
}
