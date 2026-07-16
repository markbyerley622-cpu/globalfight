// Structured logging for the ingestion pipeline. Pino in production (JSON,
// ingestible by Datadog/Logtail/etc.); falls back to console if pino is absent.
let pino: typeof import("pino").default | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
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

export const log: Logger = pino
  ? (pino({ level: process.env.LOG_LEVEL ?? "info", base: { svc: "scraper" } }) as unknown as Logger)
  : consoleLogger({ svc: "scraper" });
