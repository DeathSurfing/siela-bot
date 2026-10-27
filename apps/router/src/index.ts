import { loadRouterConfig } from "@siela/config";
import { createLogger } from "./logger.js";
import { RouterServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadRouterConfig();
  process.env.TZ = config.TZ;
  const logger = createLogger(config.LOG_LEVEL);

  const server = new RouterServer({
    token: config.MCP_TOKEN,
    commanderUrl: config.COMMANDER_URL,
    nodesRaw: config.NODES,
    logger,
  });
  await server.start(config.ROUTER_HOST, config.ROUTER_PORT);
  logger.info(
    { host: config.ROUTER_HOST, port: config.ROUTER_PORT, commander: config.COMMANDER_URL },
    "voice router started",
  );

  let stopped = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopped) return;
    stopped = true;
    logger.info({ signal }, "shutting down");
    await server.stop();
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
