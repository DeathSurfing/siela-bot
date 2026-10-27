import type { Logger } from "../lib/logger.js";

/**
 * Controls the synthesis model's lifetime. The service loads weights on
 * first use and can drop them again, so an idle container holds no model.
 * Failures are logged and ignored: synthesis lazily loads on its own.
 */
function serviceUrl(): string | null {
  const url = process.env.TTS_SERVICE_URL;
  return url ? url.replace(/\/+$/, "") : null;
}

async function call(path: string, timeoutMs: number): Promise<boolean> {
  const base = serviceUrl();
  if (!base) return false;
  try {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Start loading the model so the first utterance does not wait. */
export async function warmupTtsService(logger: Logger): Promise<void> {
  const ok = await call("/warmup", 30_000);
  if (!ok) logger.debug("tts warmup skipped or failed");
}

/** Drop the model to release its memory. */
export async function unloadTtsService(logger: Logger): Promise<void> {
  const ok = await call("/unload", 10_000);
  if (!ok) logger.debug("tts unload skipped or failed");
}
