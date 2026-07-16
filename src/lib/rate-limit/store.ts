// Rate-limit storage interface.
//
// The limiter's *policy* (what the limits are, which keys they apply to) is fixed;
// only the *counter storage* varies. Splitting them means a single-instance deploy
// keeps a zero-dependency in-memory counter, while a multi-instance deploy gets a
// shared one, with no call-site changes.

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets. Safe to expose via Retry-After. */
  retryAfter: number;
}

export interface RateLimitStore {
  readonly name: string;
  /** Consume one unit against `key`. */
  hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
  /** Clear a key (used after a successful auth so a legitimate user isn't punished). */
  reset(key: string): Promise<void>;
}
