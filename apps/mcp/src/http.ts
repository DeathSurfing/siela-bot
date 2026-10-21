import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpConfig } from "@siela/config";
import { createMcpServer } from "./server.js";
import type { ControlClient } from "./control-client.js";
import type { Logger } from "./logger.js";

const MAX_BODY = 1024 * 1024;

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  if (!chunks.length) return undefined;
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return undefined;
  return JSON.parse(text);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function validToken(header: string | undefined, expectedToken: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(expectedToken);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return true;
  if (!allowed.length) return true;
  return allowed.includes(origin);
}

export interface McpHttpServer {
  server: Server;
  close(): Promise<void>;
}

export function createMcpHttpServer(
  config: McpConfig,
  client: ControlClient,
  logger: Logger,
): McpHttpServer {
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      logger.error({ err: error }, "MCP HTTP request failed");
      if (!response.headersSent) sendJson(response, 500, { error: "internal_error" });
    });
  });

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname === "/healthz") {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (url.pathname === "/readyz") {
      try {
        await client.get("/v1/status");
        sendJson(response, 200, { ready: true });
      } catch (error) {
        sendJson(response, 503, { ready: false, error: error instanceof Error ? error.message : "unavailable" });
      }
      return;
    }
    if (url.pathname !== "/mcp") {
      sendJson(response, 404, { error: "not_found" });
      return;
    }
    if (!originAllowed(request.headers.origin, config.allowedOrigins)) {
      sendJson(response, 403, { error: "origin_not_allowed" });
      return;
    }
    if (!validToken(request.headers.authorization, config.MCP_TOKEN)) {
      sendJson(response, 401, { error: "unauthorized" });
      return;
    }

    const sessionIdHeader = request.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

    if (request.method === "POST") {
      const body = await readBody(request);
      if (sessionId && sessions.has(sessionId)) {
        const transport = sessions.get(sessionId)!;
        await transport.handleRequest(request, response, body);
        return;
      }
      if (!sessionId && isInitializeRequest(body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, transport);
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        const mcpServer = createMcpServer(client, logger);
        await mcpServer.connect(transport);
        await transport.handleRequest(request, response, body);
        return;
      }
      sendJson(response, 400, { error: "bad_request", message: "No valid session or initialize request" });
      return;
    }

    if (request.method === "GET" || request.method === "DELETE") {
      if (!sessionId || !sessions.has(sessionId)) {
        sendJson(response, 404, { error: "session_not_found" });
        return;
      }
      const transport = sessions.get(sessionId)!;
      await transport.handleRequest(request, response);
      if (request.method === "DELETE") sessions.delete(sessionId);
      return;
    }

    sendJson(response, 405, { error: "method_not_allowed" });
  }

  return {
    server,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const transport of sessions.values()) void transport.close();
        sessions.clear();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
