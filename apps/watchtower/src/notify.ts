import type { Logger } from "./logger.js";

const MAX_MESSAGE = 1_900;

/** Best-effort Discord webhook. Notification failures never fail a deploy. */
export async function notify(
  webhookUrl: string | undefined,
  logger: Logger,
  content: string,
): Promise<void> {
  if (!webhookUrl) return;
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: content.slice(0, MAX_MESSAGE) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, "notification webhook rejected");
    }
  } catch (error) {
    logger.warn({ err: error }, "notification webhook failed");
  }
}
