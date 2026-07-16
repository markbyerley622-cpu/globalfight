// A tiny bounded, TTL'd LRU cache. Backs the feed's in-memory per-user state so
// it can't grow without bound (durable state lives in Postgres, so eviction is
// lossless — evicted keys re-hydrate on next access). No dependencies; kept
// separate so its eviction/TTL logic is unit-tested in isolation.

interface Entry<V> {
  value: V;
  seen: number; // last-access timestamp (ms)
}

export class BoundedCache<V> {
  private map = new Map<string, Entry<V>>();
  private _evictions = 0;

  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Recently-accessed key first; returns undefined (and drops it) when expired. */
  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (this.now() - e.seen > this.ttlMs) { this.map.delete(key); return undefined; }
    // mark most-recently-used
    this.map.delete(key);
    e.seen = this.now();
    this.map.set(key, e);
    return e.value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, seen: this.now() });
    this.evict();
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  /** Live entries (skips expired). For persistence snapshots. */
  entries(): [string, V][] {
    const out: [string, V][] = [];
    const cutoff = this.now() - this.ttlMs;
    for (const [k, e] of this.map) if (e.seen >= cutoff) out.push([k, e.value]);
    return out;
  }

  get size(): number { return this.map.size; }
  get evictions(): number { return this._evictions; }

  // Evict least-recently-used (Map iteration order = insertion/refresh order) and
  // any expired entries once we're over capacity.
  private evict(): void {
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
      this._evictions++;
    }
  }
}
