import type { Logger } from "./logger.js";
import { failureDetail, runCommand, sleep } from "./run.js";

export interface HealthResult {
  ok: boolean;
  detail: string;
}

const BOT_CONTAINER = "siela-bot";
const READYZ =
  "import urllib.request; urllib.request.urlopen('http://127.0.0.1:3002/readyz', timeout=10).read()";

export async function waitForBotHealthy(
  timeoutSec: number,
  logger: Logger,
): Promise<HealthResult> {
  const deadline = Date.now() + timeoutSec * 1000;
  let lastDetail = "no health check completed";

  for (;;) {
    const status = await runCommand(
      "podman",
      ["ps", "--filter", `name=^${BOT_CONTAINER}$`, "--format", "{{.Status}}"],
      { timeoutMs: 30_000 },
    );

    if (status.code !== 0) {
      lastDetail = `podman ps failed: ${failureDetail(status)}`;
    } else if (!/^up /i.test(status.stdout.trim())) {
      lastDetail = `container status: ${status.stdout.trim() || "not running"}`;
    } else {
      const healthcheck = await runCommand("podman", ["healthcheck", "run", BOT_CONTAINER], {
        timeoutMs: 90_000,
      });
      if (healthcheck.code !== 0) {
        lastDetail = `healthcheck: ${failureDetail(healthcheck)}`;
      } else {
        const ready = await runCommand(
          "podman",
          ["exec", BOT_CONTAINER, "python3", "-c", READYZ],
          { timeoutMs: 30_000 },
        );
        if (ready.code !== 0) {
          lastDetail = `/readyz: ${failureDetail(ready)}`;
        } else {
          logger.info("bot health gate passed");
          return { ok: true, detail: "healthcheck and /readyz passed" };
        }
      }
    }

    if (Date.now() >= deadline) {
      logger.error({ detail: lastDetail }, "bot health gate failed");
      return { ok: false, detail: lastDetail };
    }
    logger.info({ detail: lastDetail }, "waiting for bot health");
    await sleep(5_000);
  }
}
