import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadMcpConfig } from "@siela/config";
import { ControlClient } from "./control-client.js";
import { createMcpServer } from "./server.js";
import { createMcpHttpServer } from "./http.js";
import { createLogger } from "./logger.js";

function parseArgs(argv: string[]): { stdio: boolean; mcpUrl?: string } {
  const result: { stdio: boolean; mcpUrl?: string } = { stdio: false };
  for (const arg of argv) {
    if (arg === "--stdio") result.stdio = true;
    if (arg.startsWith("--mcp-url=")) result.mcpUrl = arg.slice("--mcp-url=".length);
  }
  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadMcpConfig();
  process.env.TZ = config.TZ;
  const logger = createLogger(config.LOG_LEVEL);
  const mcpUrl = args.mcpUrl ?? config.MCP_URL;
  const client = new ControlClient(config.CONTROL_API_URL, config.MCP_TOKEN, logger);

  if (args.stdio || config.MCP_TRANSPORT === "stdio") {
    const server = createMcpServer(client, logger);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("MCP server running over stdio");
    return;
  }

  const httpServer = createMcpHttpServer(config, client, logger);
  await new Promise<void>((resolve, reject) => {
    httpServer.server.once("error", reject);
    httpServer.server.listen(config.MCP_HTTP_PORT, config.MCP_HTTP_HOST, () => {
      httpServer.server.off("error", reject);
      resolve();
    });
  });
  logger.info(
    { host: config.MCP_HTTP_HOST, port: config.MCP_HTTP_PORT, mcpUrl },
    "MCP server listening",
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down MCP server");
    await httpServer.close().catch((error) => logger.error({ err: error }, "MCP shutdown failed"));
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
