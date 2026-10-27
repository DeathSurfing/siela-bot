import "dotenv/config";
import { loadBotConfig } from "@siela/config";
import { createDatabase } from "@siela/db";
import { VoiceWorkerNode } from "./workerNode.js";
import { createLogger } from "./lib/logger.js";

async function main(): Promise<void> {
  const config = loadBotConfig();
  if (config.NODE_ROLE !== "voice") {
    throw new Error("worker entrypoint requires NODE_ROLE=voice");
  }
  process.env.TZ = config.TZ;
  const logger = createLogger(config.LOG_LEVEL);
  const db = createDatabase(config.DATABASE_URL);
  const node = new VoiceWorkerNode(config, db, logger);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    await node.stop().catch((error) => logger.error({ err: error }, "shutdown failed"));
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  await node.start();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
