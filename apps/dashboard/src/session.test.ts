import { describe, expect, it } from "vitest";
import { constantTimePasswordMatch, csrfToken, issueSession, verifyCsrf, verifySession } from "./session.js";

const secret = "session-secret-that-is-at-least-thirty-two-characters";

describe("dashboard sessions", () => {
  it("issues and verifies a twelve-hour session", () => {
    const now = 1_700_000_000_000;
    const cookie = issueSession(secret, now);

    expect(verifySession(cookie, secret, now)).toEqual({ exp: now + 12 * 60 * 60 * 1000 });
    expect(verifySession(cookie, secret, now + 12 * 60 * 60 * 1000)).toBeNull();
  });

  it("round-trips the signed Discord identity", () => {
    const now = 1_700_000_000_000;
    const user = { id: "111111111111111111", name: "Owner", avatarUrl: "https://cdn.discordapp.com/a.png" };
    const cookie = issueSession(secret, now, user);
    expect(verifySession(cookie, secret, now)).toEqual({ exp: now + 12 * 60 * 60 * 1000, user });
  });

  it("rejects a tampered signature and payload", () => {
    const cookie = issueSession(secret);
    const [payload, signature] = cookie.split(".");

    expect(verifySession(`${payload}.tampered`, secret)).toBeNull();
    expect(verifySession(`e30.${signature}`, secret)).toBeNull();
  });

  it("derives a CSRF token and rejects a mismatch", () => {
    const cookie = issueSession(secret);
    const token = csrfToken(cookie, secret);

    expect(verifyCsrf(cookie, token, secret)).toBe(true);
    expect(verifyCsrf(cookie, `${token}x`, secret)).toBe(false);
  });

  it("compares passwords without accepting prefixes", () => {
    expect(constantTimePasswordMatch("long-password-value", "long-password-value")).toBe(true);
    expect(constantTimePasswordMatch("long-password-value", "long-password")).toBe(false);
  });
});
