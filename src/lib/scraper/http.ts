// ════════════════════════════════════════════════════════════════════════
//  HTTP layer for facts-only ingestion (Wikipedia / RSS).
//
//  Deliberately an HONEST client — no evasion posture:
//    • One identifying bot User-Agent (no rotation / no browser spoofing).
//    • No proxy pool, no residential proxies.
//    • No Cloudflare-challenge solving, no headless-browser bypass.
//    • No cookie/session spoofing.
//    • Conservative global rate limit + bounded retry.
//  A plain fetch that a site can identify and block via robots/WAF if it wants.
//  If a request is blocked (403/429) we back off and give up — we do not try to
//  defeat the block.
// ════════════════════════════════════════════════════════════════════════

import pRetry, { AbortError } from "p-retry";
import { log } from "./logger";
import { BOT_USER_AGENT, isTerminal, retryAfterMs } from "@/lib/http-identity";

const RATE_LIMIT_MS = Number(process.env.SCRAPER_RATE_LIMIT_MS ?? 5000);
const MAX_RETRIES = Number(process.env.SCRAPER_MAX_RETRIES ?? 2);

// A single, honest, identifying User-Agent. Not configurable to a spoofed
// browser string — the point is to be identifiable.
const USER_AGENT = BOT_USER_AGENT;

let lastAt = 0;
async function throttle() {
  const wait = RATE_LIMIT_MS - (Date.now() - lastAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
}

export interface FetchResult { url: string; html: string; status: number }

/** Rate-limited, bounded-retry, honest fetch of a single public page. */
export async function fetchPage(url: string): Promise<FetchResult> {
  if (process.env.ENABLE_SCRAPER !== "true") {
    throw new Error("Scraper disabled (set ENABLE_SCRAPER=true).");
  }

  return pRetry(
    async () => {
      await throttle();
      const child = log.child({ url });
      child.info({}, "fetch:start");

      const resp = await fetch(url, {
        headers: { "user-agent": USER_AGENT, "accept-language": "en-US,en" },
        redirect: "follow",
      });
      const html = await resp.text();

      // A refusal is FINAL.
      //
      // This previously threw a plain Error, which p-retry treats as a transient
      // failure — so a 403 was re-fetched MAX_RETRIES more times. The comment said
      // "back off and abort, never try to bypass"; the code hammered the block three
      // times. A false reassuring comment is worse than no comment.
      //
      // AbortError is the only thing p-retry will not retry. 401/403/404/429 all
      // mean stop, and we honour Retry-After when the server sends one.
      if (isTerminal(resp.status)) {
        const wait = retryAfterMs(resp.headers);
        child.warn(
          { status: resp.status, retryAfterMs: wait },
          "fetch:blocked — respecting the refusal, not retrying",
        );
        throw new AbortError(
          `blocked: ${resp.status}${wait !== null ? ` (retry-after ${Math.round(wait / 1000)}s)` : ""} — not retried`,
        );
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`); // 5xx: transient, retried

      child.info({ status: resp.status, bytes: html.length }, "fetch:ok");
      return { url, html, status: resp.status };
    },
    {
      retries: MAX_RETRIES,
      onFailedAttempt: (e) =>
        log.warn({ url, attempt: e.attemptNumber, left: e.retriesLeft, err: e.message }, "fetch:retry"),
    },
  );
}
