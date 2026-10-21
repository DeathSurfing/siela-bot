import { randomUUID } from "node:crypto";
import type { Logger } from "./logger.js";

export class ControlError extends Error {
  constructor(
    message: string,
    readonly code = "control_error",
    readonly status = 500,
  ) {
    super(message);
    this.name = "ControlError";
  }
}

export class ControlClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly logger: Logger,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    options: { body?: unknown; query?: Record<string, string | number | boolean | undefined> } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    const requestId = randomUUID();
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          "x-request-id": requestId,
          "x-actor": "mcp",
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      this.logger.warn({ err: error, path, requestId }, "control request failed");
      throw new ControlError("The bot control API is unreachable.", "unreachable", 503);
    }

    const text = await response.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: { code: "invalid_response", message: text.slice(0, 200) } };
      }
    }

    if (!response.ok) {
      const errorBody = data as { error?: { code?: string; message?: string } } | undefined;
      throw new ControlError(
        errorBody?.error?.message ?? `Control API error ${response.status}`,
        errorBody?.error?.code ?? "control_error",
        response.status,
      );
    }
    return data as T;
  }

  get<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>("GET", path, { query });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, { body });
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, { body });
  }

  delete<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>("DELETE", path, { query });
  }
}
