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

// Lazy Redis — loaded only when REDIS_URL is set, using node-redis v4 (the
// `redis` package that is actually a dependency; the previous code imported
// `ioredis`, which is NOT installed, so it silently fell back to the Map on
// every call and the distributed cache never engaged). A single connection is
// memoized for the process; on any failure we log ONCE and fall back to the
// in-process Map, so a Redis outage degrades performance but never 500s a page.
type RedisAdapter = {
  get(k: string): Promise<string | null>;
  set(k: string, v: string, ttlSeconds: number): Promise<unknown>;
  del(k: string): Promise<unknown>;
};

let redis: RedisAdapter | null = null;
let redisInit: Promise<RedisAdapter | null> | null = null;

async function connectRedis(): Promise<RedisAdapter | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    // Non-literal specifier + webpackIgnore keep node-redis out of the client/
    // edge bundle; it is required only in the Node server runtime.
    const pkg = "redis";
    const mod = await import(/* webpackIgnore: true */ pkg);
    const client = mod.createClient({ url });
    client.on("error", (e: unknown) => {
      console.error("[cache] redis client error:", (e as Error)?.message ?? e);
    });
    await client.connect();
    console.info("[cache] Redis connected — hot reads served from Redis.");
    redis = {
      get: (k) => client.get(k),
      set: (k, v, ttl) => client.set(k, v, { EX: ttl }),
      del: (k) => client.del(k),
    };
    return redis;
  } catch (e) {
    // The single most important line: make the silent fallback VISIBLE, because
    // at >1 instance each process would otherwise serve its own divergent Map
    // with no cross-instance invalidation and no warning.
    console.error(
      "[cache] REDIS_URL is set but Redis is unavailable — falling back to the " +
        "in-process cache, which is NOT shared across instances:",
      (e as Error)?.message ?? e,
    );
    return null;
  }
}

async function getRedis(): Promise<RedisAdapter | null> {
  if (redis) return redis;
  if (!process.env.REDIS_URL) return null;
  if (!redisInit) redisInit = connectRedis();
  return redisInit;
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
    await r.set(key, JSON.stringify(value), ttlSeconds);
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
