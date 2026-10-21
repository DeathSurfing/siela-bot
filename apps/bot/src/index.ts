import "dotenv/config";
import { loadBotConfig } from "@siela/config";
import { createDatabase } from "@siela/db";
import { SielaBot } from "./bot.js";
import { createLogger } from "./lib/logger.js";

async function main(): Promise<void> {
  const config = loadBotConfig();
  process.env.TZ = config.TZ;
  const logger = createLogger(config.LOG_LEVEL);
  const db = createDatabase(config.DATABASE_URL);
  const bot = new SielaBot(config, db, logger);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    await bot.stop().catch((error) => logger.error({ err: error }, "shutdown failed"));
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  await bot.start();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
