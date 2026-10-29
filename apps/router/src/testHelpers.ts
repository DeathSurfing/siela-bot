import { vi } from "vitest";
import { RouterServer } from "./server.js";
import { createLogger } from "./logger.js";

export const TEST_TOKEN = "test-token-12345678";

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export interface StubFleetOptions {
  musicBusy?: string[];
  ttsOn?: string[];
  onCall?: (method: string, target: string) => void;
  onHeaders?: (method: string, target: string, headers: Headers) => void;
}

/** Fetch stub that passes localhost through and answers worker endpoints. */
export function stubFleetFetch(options: StubFleetOptions = {}): { calls: string[] } {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      if (target.startsWith("http://127.0.0.1")) return realFetch(target, init);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${target}`);
      options.onCall?.(method, target);
      options.onHeaders?.(method, target, new Headers(init?.headers as RequestInit["headers"]));
      const host = target.split("/")[2] ?? "";
      if (target.endsWith("/internal/music/state")) {
        const busy = (options.musicBusy ?? []).includes(host);
        return jsonResponse({ playing: busy, current: busy ? { title: "t" } : null });
      }
      if (target.endsWith("/internal/tts/state")) {
        const on = (options.ttsOn ?? []).includes(host);
        return jsonResponse({ enabled: on, channelId: "ch1" });
      }
      if (target.endsWith("/internal/music/play")) return jsonResponse({ added: 1 });
      return jsonResponse({ ok: true });
    }),
  );
  return { calls };
}

export async function withRouterServer(
  port: number,
  nodesRaw: string | undefined,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const server = new RouterServer({
    token: TEST_TOKEN,
    commanderUrl: "http://commander:3001",
    nodesRaw,
    guildId: null,
    logger: createLogger("silent"),
  });
  await server.start("127.0.0.1", port);
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await server.stop();
  }
}

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${TEST_TOKEN}`, "content-type": "application/json", ...extra };
}
