import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { APP_VERSION } from "@siela/shared";
import type { ControlClient } from "./control-client.js";
import type { Logger } from "./logger.js";
import { registerTools } from "./tools.js";

export function createMcpServer(client: ControlClient, logger: Logger): McpServer {
  const server = new McpServer({
    name: "siela",
    version: APP_VERSION,
  });
  registerTools(server, client, logger);
  return server;
}
