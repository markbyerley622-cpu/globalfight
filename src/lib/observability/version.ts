/**
 * WHICH BUILD IS THIS?
 *
 * Every error report and every health response carries it. Without a commit
 * SHA, "it broke at 14:03" cannot be tied to a deploy, and the first question of
 * any incident — did we just ship this? — has no answer.
 *
 * Read from whichever variable the platform actually sets, in order of
 * specificity. Render exposes RENDER_GIT_COMMIT; Vercel exposes
 * VERCEL_GIT_COMMIT_SHA; GitHub Actions exposes GITHUB_SHA. APP_COMMIT_SHA is
 * the manual override for anything else.
 *
 * NEXT_PUBLIC_ prefix on the client copy is required for it to be inlined into
 * the browser bundle at build time — without it the client reports "unknown"
 * while the server reports the real SHA, which is worse than neither.
 */
const RAW =
  process.env.APP_COMMIT_SHA ??
  process.env.NEXT_PUBLIC_APP_COMMIT_SHA ??
  process.env.RENDER_GIT_COMMIT ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.GITHUB_SHA ??
  null;

/** Full SHA when known, else "unknown" — never an empty string. */
export const COMMIT_SHA = RAW && RAW.length > 0 ? RAW : "unknown";

/** Short form, for logs and UI. */
export const COMMIT_SHORT = COMMIT_SHA === "unknown" ? "unknown" : COMMIT_SHA.slice(0, 7);

/** Deployment environment, as the platform reports it. */
export const APP_ENV =
  process.env.APP_ENV ?? process.env.RENDER_SERVICE_NAME ?? process.env.NODE_ENV ?? "development";

/** Process start, so health can report real uptime rather than request time. */
const BOOTED_AT = Date.now();
export const uptimeSeconds = () => Math.round((Date.now() - BOOTED_AT) / 1000);
