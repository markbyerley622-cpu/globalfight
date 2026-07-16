import type { RateLimitStore, RateLimitResult } from "./store";

/**
 * Shared fixed-window counter backed by Redis. Required for any deploy running
 * more than one instance — the in-memory store is per-process, so N instances
 * would multiply every limit by N.
 *
 * `redis` is an OPTIONAL dependency: it is imported lazily and only when
 * RATE_LIMIT_REDIS_URL is configured, so local development and single-instance
 * deploys never need it installed.
 *
 * The window is atomic: INCR then EXPIRE-on-first-hit, issued as one pipeline, so
 * two instances racing on the same key cannot both see count=1.
 */
export class RedisRateLimitStore implements RateLimitStore {
  readonly name = "redis";

  /* eslint-disable @typescript-eslint/no-explicit-any */
  private client: any = null;
  private connecting: Promise<any> | null = null;

  constructor(private readonly url: string, private readonly prefix = "rl:") {}

  private async connect(): Promise<any> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const mod = "redis";
      const redis = (await import(/* webpackIgnore: true */ mod).catch(() => null)) as any;
      if (!redis) {
        throw new Error(
          "RATE_LIMIT_REDIS_URL is set but the `redis` package is not installed. Run `npm i redis`.",
        );
      }
      const client = redis.createClient({
        url: this.url,
        socket: {
          connectTimeout: 2_000,
          // Bounded retries. The default reconnect strategy retries forever, which
          // turns an unreachable Redis into a hung request rather than a fast,
          // fail-closed 429. Give up after a few attempts and let hit() deny.
          reconnectStrategy: (retries: number) => (retries > 3 ? false : Math.min(retries * 100, 500)),
        },
      });
      // Never let a Redis blip take the process down; hit() fails closed instead.
      client.on("error", () => {});
      await client.connect();
      this.client = client;
      return client;
    })();

    return this.connecting;
  }

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const k = this.prefix + key;
    const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000));

    let count: number;
    let ttl: number;
    try {
      const client = await this.connect();
      // One round trip, atomic per key.
      const [incr] = await client.multi().incr(k).expire(k, ttlSeconds, "NX").exec();

      count = typeof incr === "number" ? incr : Number(incr);

      // Don't trust the reply shape. A successful INCR always returns >= 1, so a
      // null/undefined/garbage reply means the command did not run. Coercing it
      // would be dangerous rather than merely wrong: `Number(null)` is 0 (not NaN),
      // and `0 > limit` is false — so a malformed reply would ALLOW the request
      // instead of denying it. Anything that isn't a real count is a failure.
      if (!Number.isFinite(count) || count < 1) throw new Error("redis returned no usable count");

      ttl = await client.ttl(k);
    } catch {
      // FAIL CLOSED. If we cannot count attempts, we cannot bound them — and a
      // rate limiter that opens under load is a rate limiter an attacker turns off
      // by overloading it. Better a brief 429 for honest users than an unbounded
      // credential-stuffing window.
      //
      // Reset the connection so the next call retries rather than reusing a client
      // stuck in a permanently-failed state.
      this.connecting = null;
      this.client = null;
      return { ok: false, retryAfter: ttlSeconds };
    }

    if (count > limit) {
      return { ok: false, retryAfter: ttl > 0 ? ttl : ttlSeconds };
    }
    return { ok: true, retryAfter: 0 };
  }

  async reset(key: string): Promise<void> {
    try {
      const client = await this.connect();
      await client.del(this.prefix + key);
    } catch {
      // A failed reset only means a legitimate user keeps their existing window.
      // Not a security problem; not worth throwing over.
    }
  }

  /** Test-only teardown. */
  async _disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit().catch(() => {});
      this.client = null;
      this.connecting = null;
    }
  }
}
