// Shared JSON fetch for prediction providers.
//
// This file previously sent a spoofed Chrome User-Agent, and its own comment said
// why: "a browser UA (some upstream edges 403 a bare fetch UA)". It also treated
// 429 as retryable, so it backed off 300ms and hammered a rate-limit refusal again.
//
// Both are gone. We identify honestly, and a refusal is final.

import {
  BOT_USER_AGENT, isRetryable, isTerminal, retryAfterMs,
} from "@/lib/http-identity";

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly url: string,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

export type FetchJsonOptions = {
  timeoutMs?: number;
  retries?: number;
  /** Extra headers (e.g. Accept). */
  headers?: Record<string, string>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Bounded exponential backoff, transient failures only. */
const backoffMs = (attempt: number) => Math.min(4000, 300 * 2 ** attempt);

export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const { timeoutMs = 8000, retries = 1, headers = {} } = opts;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": BOT_USER_AGENT, accept: "application/json", ...headers },
        signal: AbortSignal.timeout(timeoutMs),
        // Provider data is cached by our SWR layer, not Next's fetch cache.
        cache: "no-store",
      });

      if (!res.ok) {
        // 401/403/404/429 mean STOP. Retrying a refusal is not resilience — it is
        // ignoring the answer. If the server told us how long to wait, we surface
        // that, but we still do not retry within this call.
        if (isTerminal(res.status)) {
          const wait = retryAfterMs(res.headers);
          throw new ProviderHttpError(
            `HTTP ${res.status}${wait !== null ? ` (retry-after ${Math.round(wait / 1000)}s)` : ""}`,
            res.status,
            url,
          );
        }

        if (isRetryable(res.status) && attempt < retries) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new ProviderHttpError(`HTTP ${res.status}`, res.status, url);
      }

      // Guard against HTML error/redirect pages (e.g. an ISP filter) sneaking
      // through as 200 — JSON parse will throw, which we surface cleanly.
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;

      // A terminal status is never retried, at any attempt.
      if (err instanceof ProviderHttpError && err.status !== null && isTerminal(err.status)) {
        throw err;
      }

      const retryable =
        err instanceof ProviderHttpError
          ? err.status !== null && isRetryable(err.status)
          : true; // timeouts / network / parse errors are transient

      if (attempt < retries && retryable) {
        await sleep(backoffMs(attempt));
        continue;
      }
      break;
    }
  }

  if (lastErr instanceof ProviderHttpError) throw lastErr;
  throw new ProviderHttpError(
    lastErr instanceof Error ? lastErr.message : "fetch failed",
    null,
    url,
  );
}
