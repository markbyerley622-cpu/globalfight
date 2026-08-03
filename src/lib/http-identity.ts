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

// The contact URL is the ENTIRE point of an honest User-Agent: it is the only
// way a site operator we fetch from can find out who we are, ask us to slow
// down, or ask us to stop. It must therefore resolve.
//
// It did not. The UA advertised `https://combat-register.vercel.app/bot`, which
// answered 404 — on a Vercel deployment of a former name of this project, while
// the app runs on Render. So every request this application has ever made
// carried a claim of accountability that led nowhere, which is worse than
// sending no contact at all: it looks like due diligence and delivers none.
//
// Resolved from the deployment's own origin, with the current production host as
// the fallback, so it cannot silently rot back to a dead address. The /bot page
// is a real route (src/app/bot/page.tsx) — if you move it, move this.
const BOT_INFO_URL = `${(process.env.NEXT_PUBLIC_SITE_URL ?? "https://globalfight-p69k.onrender.com").replace(/\/+$/, "")}/bot`;

/**
 * The only User-Agent this application may send.
 *
 * Note what this is NOT: it does not claim to be a browser, it is not rotated,
 * and it is not configurable. Some hosts refuse it for exactly that reason —
 * their WAF filters on the UA string rather than on who is asking. That refusal
 * is respected (TERMINAL_STATUSES treats 403 as "stop"), and the answer to a
 * blocked source is a different source, never a different disguise.
 */
export const BOT_USER_AGENT = `CombatReviewsBot/2.1 (+${BOT_INFO_URL})`;

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
