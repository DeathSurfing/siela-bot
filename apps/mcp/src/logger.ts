import pino from "pino";

export type Logger = pino.Logger;

export function createLogger(level = "info"): Logger {
  return pino({
    level,
    base: { app: "siela-mcp" },
    redact: {
      paths: ["token", "*.token", "authorization", "headers.authorization", "content", "*.content"],
      censor: "[redacted]",
    },
  });
}
