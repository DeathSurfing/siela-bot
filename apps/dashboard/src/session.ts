import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "siela_dashboard";
export const OAUTH_STATE_COOKIE = "siela_oauth_state";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export interface SessionUser {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface SessionPayload {
  exp: number;
  user?: SessionUser;
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash) && left.length === right.length;
}

export function issueSession(secret: string, now = Date.now(), user?: SessionUser): string {
  const payload = Buffer.from(
    JSON.stringify({
      exp: now + SESSION_TTL_SECONDS * 1000,
      ...(user ? { user } : {}),
    }),
  ).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifySession(cookie: string | undefined, secret: string, now = Date.now()): SessionPayload | null {
  if (!cookie) return null;
  const separator = cookie.lastIndexOf(".");
  if (separator <= 0) return null;

  const payload = cookie.slice(0, separator);
  const suppliedSignature = cookie.slice(separator + 1);
  if (!constantTimeEqual(suppliedSignature, signature(payload, secret))) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (!Number.isSafeInteger(decoded.exp) || typeof decoded.exp !== "number" || decoded.exp <= now) return null;
    const user = decoded.user;
    if (user !== undefined) {
      if (
        typeof user !== "object" ||
        user === null ||
        typeof user.id !== "string" ||
        typeof user.name !== "string" ||
        (user.avatarUrl !== null && typeof user.avatarUrl !== "string")
      ) {
        return null;
      }
    }
    return { exp: decoded.exp, ...(user ? { user } : {}) };
  } catch {
    return null;
  }
}

export function csrfToken(cookie: string, secret: string): string {
  const payload = cookie.slice(0, cookie.lastIndexOf("."));
  return createHmac("sha256", secret).update(payload).digest("base64url").slice(0, 32);
}

export function verifyCsrf(cookie: string, provided: string | undefined, secret: string): boolean {
  return Boolean(provided && constantTimeEqual(csrfToken(cookie, secret), provided));
}

export function constantTimePasswordMatch(expected: string, provided: string): boolean {
  const expectedHash = createHash("sha256").update(expected).digest();
  const providedHash = createHash("sha256").update(provided).digest();
  return timingSafeEqual(expectedHash, providedHash) && expected.length === provided.length;
}

export function constantTimeTokenMatch(expected: string, provided: string | undefined): boolean {
  return Boolean(provided && constantTimeEqual(expected, provided));
}

export function readCookie(header: string | undefined, name = SESSION_COOKIE): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}
