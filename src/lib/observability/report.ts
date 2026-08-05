import { redact, safeHeaders, scrubString } from "./redact";
import { COMMIT_SHA, COMMIT_SHORT, APP_ENV } from "./version";

// ════════════════════════════════════════════════════════════════════════════
//  ERROR REPORTING — one function, vendor-neutral.
//
//  ── Why not a vendor SDK ─────────────────────────────────────────────────
//  Nothing here imports Sentry, Datadog or anything else, and that is a
//  deliberate constraint rather than an omission. An SDK is a runtime
//  dependency in the hot path, a bundle-size cost on the client, a second
//  redaction pipeline that is not ours, and a decision that is expensive to
//  reverse. What this app actually needs first is: errors leave the process
//  with enough context to act on, and nothing sensitive goes with them.
//
//  So this posts a small JSON envelope to whatever `ERROR_REPORT_URL` points at
//  — a vendor ingest endpoint, a webhook, a log drain, an internal collector.
//  Adding a real SDK later means changing `deliver()` and nothing else.
//
//  ── Disabled is the default ──────────────────────────────────────────────
//  With no URL configured this degrades to structured console output. It never
//  throws, never blocks a response, and never changes behaviour — an
//  observability layer that can break the request it is observing is worse than
//  no observability.
// ════════════════════════════════════════════════════════════════════════════

export type Severity = "warn" | "error" | "fatal";

export interface ErrorContext {
  /** Where it happened: a route path, a job name, "boot". */
  source?: string;
  /** Request path, when there is one. */
  path?: string;
  method?: string;
  /** The AUTHENTICATED USER ID only — never a name, handle or email. */
  userId?: string | null;
  /** Correlates a client report with its server-side stack (Next's digest). */
  digest?: string | null;
  /** Ties every log line and error for one request together. */
  requestId?: string | null;
  headers?: Headers | Record<string, string>;
  /** Anything else. Deep-redacted before transmission. */
  extra?: Record<string, unknown>;
}

export interface ErrorEnvelope {
  id: string;
  ts: string;
  severity: Severity;
  name: string;
  message: string;
  stack: string | null;
  commit: string;
  env: string;
  runtime: "server" | "client" | "edge";
  context: Record<string, unknown>;
}

const REPORT_URL = process.env.ERROR_REPORT_URL ?? "";
/** Optional bearer for the collector. Never logged, never echoed. */
const REPORT_TOKEN = process.env.ERROR_REPORT_TOKEN ?? "";

export const errorReportingEnabled = () => REPORT_URL.length > 0;

/** Short, sortable, unique enough to quote in a support ticket. */
function errorId(): string {
  return `e_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function detectRuntime(): ErrorEnvelope["runtime"] {
  if (typeof window !== "undefined") return "client";
  if (process.env.NEXT_RUNTIME === "edge") return "edge";
  return "server";
}

function toEnvelope(err: unknown, severity: Severity, ctx: ErrorContext): ErrorEnvelope {
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : "Non-Error thrown");
  return {
    id: errorId(),
    ts: new Date().toISOString(),
    severity,
    name: e.name,
    message: scrubString(e.message),
    stack: e.stack ? scrubString(e.stack) : null,
    commit: COMMIT_SHA,
    env: APP_ENV,
    runtime: detectRuntime(),
    context: {
      source: ctx.source ?? null,
      path: ctx.path ?? null,
      method: ctx.method ?? null,
      // The ID only. A report that carries a display name or an email has
      // turned an error tracker into a copy of the user table.
      userId: ctx.userId ?? null,
      digest: ctx.digest ?? null,
      requestId: ctx.requestId ?? null,
      headers: safeHeaders(ctx.headers),
      ...(ctx.extra ? { extra: redact(ctx.extra) as Record<string, unknown> } : {}),
    },
  };
}

/**
 * Ship it. Fire-and-forget by design.
 *
 * `keepalive` so a client-side report survives the navigation that often
 * accompanies a crash. Failures are swallowed: if the collector is down, that
 * is not the user's problem and must not become one.
 */
async function deliver(envelope: ErrorEnvelope): Promise<void> {
  if (!REPORT_URL) return;
  try {
    await fetch(REPORT_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(REPORT_TOKEN ? { authorization: `Bearer ${REPORT_TOKEN}` } : {}),
      },
      body: JSON.stringify(envelope),
      keepalive: true,
    });
  } catch {
    // Never escalate a telemetry failure into an application failure.
  }
}

/**
 * THE entry point. Returns the error id so a UI can show it to the user and a
 * support conversation can start with something greppable.
 */
export function reportError(err: unknown, severity: Severity, ctx: ErrorContext = {}): string {
  const envelope = toEnvelope(err, severity, ctx);

  // ALWAYS emit locally, whether or not a collector is configured. The console
  // is the fallback sink, and in development it is the only one.
  const line = JSON.stringify({
    level: severity,
    errorId: envelope.id,
    commit: COMMIT_SHORT,
    ...envelope.context,
    name: envelope.name,
    msg: envelope.message,
  });
  if (severity === "warn") console.warn(line);
  else console.error(line);
  if (envelope.stack && severity !== "warn") console.error(envelope.stack);

  void deliver(envelope);
  return envelope.id;
}
