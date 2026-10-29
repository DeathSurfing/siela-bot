import type { FleetNode } from "./nodes.js";

export class FleetHttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = "FleetHttpError";
  }
}

export interface NodeFetchOptions {
  token: string;
  method?: string;
  body?: unknown;
  timeoutMs?: number;
  /** Guild the operation targets. Voice nodes multiplex guilds by this header. */
  guildId?: string | null;
}

export async function readJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function errorMessage(parsed: unknown, fallback: string): string {
  if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
    const message = (parsed as { error: { message?: unknown } }).error?.message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

/** Find a node by ID or throw a 400. */
export function findNode(nodes: FleetNode[], nodeId: string): FleetNode {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw Object.assign(new Error(`Unknown voice node: ${nodeId}.`), { statusCode: 400 });
  }
  return node;
}

/**
 * Fetch a worker endpoint. Transport failures throw 502; HTTP errors throw
 * with the upstream status (5xx mapped to 502) and the upstream message.
 */
export async function fetchNodeJson(
  node: FleetNode,
  path: string,
  options: NodeFetchOptions,
): Promise<unknown> {
  const { token, method = "GET", body, timeoutMs = 15_000, guildId } = options;
  const url = `${node.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...(method === "GET" ? {} : { "content-type": "application/json" }),
        ...(guildId ? { "x-guild-id": guildId } : {}),
        authorization: `Bearer ${token}`,
      },
      body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new FleetHttpError(`Voice node ${node.id} is unreachable: ${(error as Error).message}`, 502);
  }
  const parsed = await readJsonSafe(response);
  if (!response.ok) {
    const status = response.status >= 500 ? 502 : response.status;
    throw new FleetHttpError(
      errorMessage(parsed, `Voice node ${node.id} returned ${response.status}.`),
      status,
      parsed,
    );
  }
  return parsed;
}
