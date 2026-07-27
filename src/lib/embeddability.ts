import "server-only";
import { readFramingHeaders, safeArticleUrl, type Embeddable } from "@/lib/embeddability-rules";

export { safeArticleUrl, readFramingHeaders };
export type { Embeddable };

// ════════════════════════════════════════════════════════════════════════════
//  Can we render this page in an iframe? The IO half.
//
//  The browser CANNOT tell us. A frame blocked by X-Frame-Options or by a CSP
//  frame-ancestors directive fails silently from the parent's point of view: no
//  distinguishable error, nothing readable across the origin boundary. The only
//  honest signal is the RESPONSE HEADERS, and only the server can read those — so
//  the check happens here, before the reader decides what to render. A client that
//  "tries the iframe and sees what happens" shows a blank rectangle for several
//  seconds and then guesses.
//
//  The decisions live in embeddability-rules (pure, unit-tested). This file only
//  fetches and caches.
//
//  ── CACHING ───────────────────────────────────────────────────────────────
//  Keyed by HOSTNAME, not URL. Framing policy is set per-site in practice, so
//  caching per article would mean one request per story for an answer we already
//  had. In-memory and per-instance on purpose: it is a latency optimisation for a
//  cheaply-rederived fact, and a shared store would be infrastructure for no gain.
//  A cold instance costs one HEAD request per publisher.
// ════════════════════════════════════════════════════════════════════════════

interface Entry extends Embeddable {
  at: number;
}

/** Publishers change framing policy rarely; a day is long enough to matter and
 *  short enough to self-heal. */
const TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, Entry>();

/** Never wait long — a reader is watching a spinner while this runs. */
const TIMEOUT_MS = 4000;

const UA = "CombatReviewsBot/1.0 (+embeddability check)";

/**
 * Is this article's host embeddable? Cached per hostname.
 *
 * Never throws and never blocks for long. On a timeout, a network error or a
 * non-OK response it returns NOT embeddable: defaulting to "yes" on an unknown
 * shows a blank iframe, which is the exact failure this exists to avoid — and the
 * fallback preview is a perfectly good experience.
 */
export async function isEmbeddable(raw: string): Promise<Embeddable> {
  const url = safeArticleUrl(raw);
  if (!url) return { embeddable: false, reason: "unsupported url" };

  const key = url.hostname.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return { embeddable: hit.embeddable, reason: hit.reason };
  }

  let result: Embeddable;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // HEAD first — we want headers, not an article body. Some publishers reject
    // HEAD, so 405/501 retries as a single-byte ranged GET rather than blaming the
    // site for our choice of method.
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": UA },
    }).catch(() => null);

    if (!res || res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": UA, range: "bytes=0-0" },
      }).catch(() => null);
    }

    if (!res) result = { embeddable: false, reason: "unreachable" };
    else if (res.status >= 400) result = { embeddable: false, reason: `http ${res.status}` };
    else result = readFramingHeaders(res.headers);
  } catch {
    result = { embeddable: false, reason: "check failed" };
  } finally {
    clearTimeout(timer);
  }

  cache.set(key, { ...result, at: Date.now() });
  return result;
}

/** Test seam — the cache is module state and would leak between cases. */
export function __clearEmbeddabilityCache(): void {
  cache.clear();
}
