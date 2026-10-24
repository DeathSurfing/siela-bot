import pino from "pino";

export type Logger = pino.Logger;

export function createLogger(level = "info"): Logger {
  return pino({
    level,
    base: { app: "siela-watchtower" },
    redact: {
      paths: [
        "token",
        "*.token",
        "authorization",
        "headers.authorization",
        "GH_TOKEN",
        "*.GH_TOKEN",
        "WATCHTOWER_TOKEN",
      ],
      censor: "[redacted]",
    },
  });
}
