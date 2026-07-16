// ════════════════════════════════════════════════════════════════════════
//  Stale-while-revalidate in-process cache.
//
//  The app has no Redis, so this is a module-level Map (per server instance) —
//  the same pattern the rest of the app uses for hot reads. Semantics:
//    • Fresh (age < ttlMs)        → return cached, no fetch.
//    • Stale (ttlMs..staleMs)     → return cached NOW, refresh in background.
//    • Expired (age > staleMs)    → await a fresh fetch.
//    • Fetch throws               → serve last-good value if we have one.
//  A single in-flight refresh per key is de-duped so a burst of requests makes
//  at most one upstream call. All transitions are logged for observability.
// ════════════════════════════════════════════════════════════════════════

import { plog } from "@/features/predictions/logger";

type Entry<T> = { value: T; storedAt: number };

export type SwrOptions = {
  /** Below this age the value is fresh (ms). */
  ttlMs: number;
  /** Above this age the value must be re-fetched before use (ms). */
  staleMs: number;
};

// NOTE: uses Date.now() — fine at runtime; unit tests inject a clock via `now`.
const log = plog.child({ mod: "cache" });

export class SwrCache {
  private store = new Map<string, Entry<unknown>>();
  private inflight = new Map<string, Promise<unknown>>();

  constructor(private now: () => number = () => Date.now()) {}

  /**
   * Get `key`, using `fetcher` to (re)populate. Never throws if a previous
   * good value exists: a failed refresh logs and serves stale.
   */
  async get<T>(key: string, fetcher: () => Promise<T>, opts: SwrOptions): Promise<T> {
    const entry = this.store.get(key) as Entry<T> | undefined;
    const age = entry ? this.now() - entry.storedAt : Infinity;

    if (entry && age < opts.ttlMs) {
      log.info({ key, ageMs: age, state: "hit" }, "cache hit");
      return entry.value;
    }

    if (entry && age < opts.staleMs) {
      // Serve stale immediately, kick a background refresh (de-duped).
      log.info({ key, ageMs: age, state: "stale" }, "cache stale — background refresh");
      void this.refresh(key, fetcher);
      return entry.value;
    }

    // Expired or cold: await a refresh, but fall back to any last-good value.
    log.info({ key, ageMs: entry ? age : null, state: entry ? "expired" : "miss" }, "cache miss");
    try {
      return await this.refresh(key, fetcher);
    } catch (err) {
      if (entry) {
        log.warn({ key, err: String(err), state: "serve-stale-on-error" }, "refresh failed — serving stale");
        return entry.value;
      }
      throw err;
    }
  }

  /** Force-refresh a key, sharing a single in-flight promise across callers. */
  refresh<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const started = this.now();
    const p = (async () => {
      const value = await fetcher();
      this.store.set(key, { value, storedAt: this.now() });
      log.info({ key, durationMs: this.now() - started, state: "refreshed" }, "cache refreshed");
      return value;
    })().finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, p);
    return p;
  }

  /** Last-good cached value without triggering a fetch (or undefined). */
  peek<T>(key: string): T | undefined {
    return (this.store.get(key) as Entry<T> | undefined)?.value;
  }

  clear(): void {
    this.store.clear();
    this.inflight.clear();
  }
}

// Shared instance for the running server. TTLs are generous — prediction odds
// drift slowly relative to page traffic, and this keeps us well under any rate
// limit while background refresh keeps data warm.
export const predictionsCache = new SwrCache();

export const MARKETS_TTL_MS = 60_000; // 1 min fresh
export const MARKETS_STALE_MS = 10 * 60_000; // up to 10 min stale-served
export const HISTORY_TTL_MS = 5 * 60_000; // history moves slower
export const HISTORY_STALE_MS = 30 * 60_000;
