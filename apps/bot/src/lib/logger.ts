import pino from "pino";

export type Logger = pino.Logger;

export function createLogger(level = "info"): Logger {
  return pino({
    level,
    base: { app: "siela-bot" },
    redact: {
      paths: [
        "token",
        "*.token",
        "authorization",
        "*.authorization",
        "req.headers.authorization",
        "headers.authorization",
        "content",
        "*.content",
        "message",
        "*.message",
        "password",
        "*.password",
      ],
      censor: "[redacted]",
    },
  });
}
