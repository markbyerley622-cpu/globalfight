// Structured logging for the ingestion pipeline. Pino in production (JSON,
// ingestible by Datadog/Logtail/etc.); falls back to console if pino is absent.
let pino: typeof import("pino").default | null = null;
try {
  pino = require("pino");
} catch {
  pino = null;
}

type Fields = Record<string, unknown>;

export interface Logger {
  info(fields: Fields, msg?: string): void;
  warn(fields: Fields, msg?: string): void;
  error(fields: Fields, msg?: string): void;
  child(bindings: Fields): Logger;
}

function consoleLogger(base: Fields = {}): Logger {
  const emit = (level: string) => (fields: Fields, msg?: string) =>
    console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
      JSON.stringify({ level, ts: new Date().toISOString(), ...base, ...fields, msg }),
    );
  return {
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
    child: (b) => consoleLogger({ ...base, ...b }),
  };
}

// Redact anything that could carry a credential or PII if a future caller logs
// an object containing one. Nothing does today (the scraper logs only URLs), but
// this is the safety net so it can never leak by accident.
// Keys with special characters (hyphens) MUST use bracket notation in pino,
// e.g. *["set-cookie"] — a bare *.set-cookie is an invalid redact path and
// throws at logger construction.
const REDACT = [
  "authorization",
  "*.authorization",
  "headers.authorization",
  "headers.cookie",
  "*.cookie",
  '*["set-cookie"]',
  "password",
  "*.password",
  "apiKey",
  "*.apiKey",
  "token",
  "*.token",
  "*.apiSportsKey",
  '*["x-rapidapi-key"]',
];

export const log: Logger = pino
  ? (pino({
      level: process.env.LOG_LEVEL ?? "info",
      base: { svc: "scraper" },
      redact: { paths: REDACT, censor: "[redacted]" },
    }) as unknown as Logger)
  : consoleLogger({ svc: "scraper" });
