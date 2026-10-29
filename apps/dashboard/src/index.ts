import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDashboardConfig } from "./config.js";
import { createDashboardServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadDashboardConfig();
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
  const app = createDashboardServer({ config, publicDir });
  await app.listen({ host: config.DASHBOARD_HOST, port: config.DASHBOARD_PORT });
  app.log.info({ host: config.DASHBOARD_HOST, port: config.DASHBOARD_PORT }, "dashboard started");

  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await app.close();
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
