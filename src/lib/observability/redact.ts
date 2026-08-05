// ════════════════════════════════════════════════════════════════════════════
//  REDACTION — what must never leave this process.
//
//  An error reporter is the single most dangerous piece of plumbing in an app:
//  it takes arbitrary application state and posts it somewhere else. Every real
//  credential-leak-via-telemetry starts with someone attaching "the request" to
//  an exception. So the rule here is deny-by-default on the KEY, and a scrub of
//  the VALUE for the shapes that leak even under an innocent key.
//
//  No `pino` redact config, no vendor SDK's `beforeSend` — those run inside the
//  vendor's pipeline and are easy to bypass by adding one more field. This runs
//  before anything is serialised, on our side, once.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Keys whose VALUE is never transmitted, at any depth.
 *
 * Matched case-insensitively as a substring, so `AUTH_SECRET`,
 * `x-auth-token`, `passwordHash` and `stripeSecretKey` are all covered without
 * enumerating them.
 */
const DENY_KEY = /pass|secret|token|auth|cookie|session|credential|apikey|api[-_]?key|signature|otp|pin\b|dsn|private/i;

/**
 * Message/body shapes that leak regardless of the key they arrive under.
 *
 * Bearer tokens and JWTs turn up inside error MESSAGES ("failed to verify
 * eyJhbGciOi…"), where no key-based rule can see them.
 */
const VALUE_SCRUBBERS: [RegExp, string][] = [
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, "[jwt]"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi, "Bearer [redacted]"],
  [/\bpostgres(?:ql)?:\/\/[^\s"']+/gi, "[database-url]"],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]"],
  // A long hex run is almost always a secret, a hash or a key in this codebase.
  [/\b[a-f0-9]{32,}\b/gi, "[hex]"],
];

export function scrubString(input: string): string {
  let out = input;
  for (const [re, replacement] of VALUE_SCRUBBERS) out = out.replace(re, replacement);
  return out;
}

/** Anything deeper than this is noise in a stack report and a recursion risk. */
const MAX_DEPTH = 4;
const MAX_ARRAY = 20;
const MAX_STRING = 2_000;

/**
 * Deep-clean a value for transmission.
 *
 * Returns plain JSON-safe data. Unknown exotic types (functions, symbols,
 * class instances) collapse to a type marker rather than being coerced —
 * `String(someClass)` is how "[object Object]" ends up in a bug report.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return "[depth]";

  const t = typeof value;
  if (t === "string") {
    const s = scrubString(value as string);
    return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…[truncated]` : s;
  }
  if (t === "number" || t === "boolean") return value;
  if (t === "bigint") return String(value);
  if (t === "function" || t === "symbol") return `[${t}]`;

  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ARRAY).map((v) => redact(v, depth + 1));
    return value.length > MAX_ARRAY ? [...head, `…+${value.length - MAX_ARRAY} more`] : head;
  }

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: scrubString(value.message), stack: scrubString(value.stack ?? "") };
  }

  if (t === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = DENY_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return `[${t}]`;
}

/**
 * Headers, minus anything that authenticates.
 *
 * An allow-list, not a deny-list: request headers are attacker-influenced and a
 * new auth header should default to being dropped, not to being sent.
 */
const HEADER_ALLOW = new Set([
  "user-agent", "referer", "accept-language", "content-type",
  "x-forwarded-for", "x-real-ip", "x-request-id",
]);

export function safeHeaders(headers: Headers | Record<string, string> | undefined): Record<string, string> {
  if (!headers) return {};
  const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers);
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    const key = k.toLowerCase();
    if (HEADER_ALLOW.has(key)) out[key] = scrubString(String(v)).slice(0, 300);
  }
  return out;
}
