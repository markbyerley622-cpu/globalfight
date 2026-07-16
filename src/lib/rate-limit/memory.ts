import type { RateLimitStore, RateLimitResult } from "./store";

/**
 * In-process fixed-window counter.
 *
 * CORRECT ONLY FOR A SINGLE INSTANCE. With N instances an attacker gets
 * (limit × N) attempts and a deploy resets every window. `startup-guard.ts`
 * refuses to boot a multi-instance production deploy that has not configured
 * shared storage, so this cannot be used unsafely by accident.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  readonly name = "memory";

  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  // Bound the map so a spray of unique keys (one per forged IP) cannot grow it
  // without limit. Evicting the oldest window is safe: the worst case is that an
  // attacker gets a fresh window, which is what waiting would give them anyway.
  private static readonly MAX_BUCKETS = 10_000;

  private evictIfNeeded(now: number) {
    if (this.buckets.size < MemoryRateLimitStore.MAX_BUCKETS) return;
    for (const [k, w] of this.buckets) if (w.resetAt <= now) this.buckets.delete(k);
    if (this.buckets.size < MemoryRateLimitStore.MAX_BUCKETS) return;
    const oldest = [...this.buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt).slice(0, 1000);
    for (const [k] of oldest) this.buckets.delete(k);
  }

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const existing = this.buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      this.evictIfNeeded(now);
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true, retryAfter: 0 };
    }

    existing.count++;
    if (existing.count > limit) {
      return { ok: false, retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
    }
    return { ok: true, retryAfter: 0 };
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }

  /** Test-only. */
  _clearAll(): void {
    this.buckets.clear();
  }
}
