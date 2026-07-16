// ════════════════════════════════════════════════════════════════════════
//  Cache layer — aggressive caching for scraped data & ranking snapshots.
//
//  Strategy:
//   • the data source is NEVER hit on a page request. Pages read from Postgres, which
//     is populated by background cron jobs (see /api/cron/*).
//   • This module fronts those reads with Redis so hot pages (homepage,
//     rankings, P4P) serve from memory.
//   • If REDIS_URL is unset we fall back to an in-process LRU-ish Map so the
//     app still runs locally with zero infra.
// ════════════════════════════════════════════════════════════════════════

type Entry = { value: unknown; expires: number };
const memory = new Map<string, Entry>();

// Lazy Redis — only require the client if a URL is configured. (Add `ioredis`
// to dependencies when going live; kept optional here so install stays light.)
let redis: { get(k: string): Promise<string | null>; set(k: string, v: string, mode: string, ttl: number): Promise<unknown>; del(k: string): Promise<unknown> } | null = null;

async function getRedis() {
  if (redis || !process.env.REDIS_URL) return redis;
  try {
    // Non-literal specifier: keeps TS/bundler from requiring `ioredis` at
    // build time. Add `ioredis` to dependencies when enabling Redis in prod.
    const pkg = "ioredis";
    const mod = (await import(/* webpackIgnore: true */ pkg).catch(() => null)) as
      | { default: new (url: string) => NonNullable<typeof redis> }
      | null;
    if (!mod) return null;
    const Redis = mod.default;
    redis = new Redis(process.env.REDIS_URL);
  } catch {
    redis = null;
  }
  return redis;
}

export const CACHE_TTL = {
  RANKINGS: 60 * 30,     // 30 min
  FIGHTER: 60 * 60 * 12, // 12 h
  EVENTS: 60 * 15,       // 15 min
  SEARCH: 60 * 5,        // 5 min
} as const;

export async function cached<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  const r = await getRedis();
  if (r) {
    const hit = await r.get(key);
    if (hit) return JSON.parse(hit) as T;
    const value = await loader();
    await r.set(key, JSON.stringify(value), "EX", ttlSeconds);
    return value;
  }

  // In-memory fallback
  const now = Date.now();
  const hit = memory.get(key);
  if (hit && hit.expires > now) return hit.value as T;
  const value = await loader();
  memory.set(key, { value, expires: now + ttlSeconds * 1000 });
  return value;
}

export async function invalidate(key: string): Promise<void> {
  memory.delete(key);
  const r = await getRedis();
  if (r) await r.del(key);
}
