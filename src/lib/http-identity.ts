// ════════════════════════════════════════════════════════════════════════
//  Outbound HTTP identity — one honest User-Agent for the whole application.
//
//  We previously sent a spoofed Chrome UA from two PRODUCTION code paths (the
//  15-minute news cron, and the predictions HTTP client). The predictions client
//  even carried a comment admitting why: "some upstream edges 403 a bare fetch UA".
//  That is a written admission of disguising a bot to defeat an access control, and
//  it converts a weak "we only read public pages" position into something much
//  worse.
//
//  There is now one identity, it is truthful, and it says who to contact.
// ════════════════════════════════════════════════════════════════════════

/** The only User-Agent this application may send. */
export const BOT_USER_AGENT =
  "CombatRegisterBot/2.0 (+https://combat-register.vercel.app/bot)";

export const BOT_HEADERS: Record<string, string> = {
  "user-agent": BOT_USER_AGENT,
};

/**
 * Status codes that mean "stop", not "try again".
 *
 * 401/403 — we are not allowed. 404 — it is not there. 429 — we were told to slow
 * down. Retrying any of these is not resilience, it is hammering a refusal. Only
 * transient failures (5xx, network) may be retried, with bounded backoff.
 */
export const TERMINAL_STATUSES = new Set([401, 403, 404, 405, 410, 429]);

export function isTerminal(status: number): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Retry only genuine transient failures. */
export function isRetryable(status: number): boolean {
  return status >= 500 && status <= 599;
}

/**
 * Honour a Retry-After header when the server sends one.
 * Returns milliseconds, or null when absent/unparseable.
 */
export function retryAfterMs(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}
