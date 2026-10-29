import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "siela_dashboard";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

interface SessionPayload {
  exp: number;
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash) && left.length === right.length;
}

export function issueSession(secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ exp: now + SESSION_TTL_SECONDS * 1000 })).toString("base64url");
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
    return { exp: decoded.exp };
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

export function readCookie(header: string | undefined, name = SESSION_COOKIE): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}
