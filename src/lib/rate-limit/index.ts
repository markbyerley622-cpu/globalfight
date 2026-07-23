// ════════════════════════════════════════════════════════════════════════
//  Rate limiting — policy + client identification.
//
//  Storage is pluggable (see ./store.ts): in-memory for a single instance, Redis
//  for many. `startup-guard.ts` refuses to boot a multi-instance production deploy
//  that has not configured shared storage, so the weaker store cannot be selected
//  unsafely by accident.
// ════════════════════════════════════════════════════════════════════════

import "server-only";
import type { RateLimitStore, RateLimitResult } from "./store";
import { MemoryRateLimitStore } from "./memory";
import { RedisRateLimitStore } from "./redis";

export type { RateLimitResult, RateLimitStore };

let store: RateLimitStore | null = null;

/** The active store. Redis when configured, otherwise in-process. */
export function rateLimitStore(): RateLimitStore {
  if (store) return store;
  const url = process.env.RATE_LIMIT_REDIS_URL;
  store = url ? new RedisRateLimitStore(url) : new MemoryRateLimitStore();
  return store;
}

/** Test-only: swap the backing store. */
export function _setStore(s: RateLimitStore | null): void {
  store = s;
}

export function hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  return rateLimitStore().hit(key, limit, windowMs);
}

export function reset(key: string): Promise<void> {
  return rateLimitStore().reset(key);
}

// ── Client identification ─────────────────────────────────────────────────

/**
 * Resolve the client IP for rate-limiting purposes.
 *
 * `x-forwarded-for` is a plain request header: anyone who can reach the origin
 * directly can set it to whatever they like, and a naive `xff.split(",")[0]` hands
 * an attacker an unlimited supply of fresh rate-limit buckets — i.e. no IP limit
 * at all.
 *
 * So we only trust the header when we know a proxy is in front of us:
 *
 *   TRUST_PROXY_HOPS=n  — the number of proxies WE control, appended to XFF by
 *                         them. We take the n-th entry from the RIGHT, which is
 *                         the address our outermost trusted proxy observed. Values
 *                         further left were supplied by the client and are forged.
 *
 * Defaults to 1 (Render and Vercel both front the app with exactly one proxy that
 * appends the real client IP). Set TRUST_PROXY_HOPS=0 when the app is reachable
 * directly, and the header is ignored entirely.
 *
 * IP limits are always PAIRED with an account-scoped limit at the call sites, so
 * even a successful spoof still hits the per-account ceiling.
 */
export function clientIp(req: Request): string {
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? "1");

  if (!Number.isFinite(hops) || hops <= 0) {
    // No trusted proxy: the header is meaningless. Everything shares one bucket,
    // which is conservative (stricter), not permissive.
    return "direct";
  }

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const chain = xff.split(",").map((s) => s.trim()).filter(Boolean);
    // The right-most entry was appended by the proxy nearest to us; walk left by
    // the number of hops we actually control.
    const idx = chain.length - hops;
    const candidate = chain[idx];
    if (candidate) return candidate;
    // Chain shorter than the configured hop count — the request did not come
    // through the expected path. Do not trust any of it.
    return "untrusted";
  }

  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

// ── Policy ────────────────────────────────────────────────────────────────
// One place, so login / reset / change / evidence cannot drift apart.

export const POLICY = {
  login: { limit: 10, windowMs: 15 * 60_000 },
  // Signup runs bcrypt(12) and creates a row per success. Bound per source host
  // so a script can neither exhaust CPU nor enumerate the membership at speed.
  signup: { limit: 8, windowMs: 60 * 60_000 },
  passwordChange: { limit: 5, windowMs: 15 * 60_000 },
  resetRequestPerIp: { limit: 5, windowMs: 15 * 60_000 },
  resetRequestPerAccount: { limit: 3, windowMs: 60 * 60_000 },
  resetConfirm: { limit: 10, windowMs: 15 * 60_000 },
  accountDelete: { limit: 5, windowMs: 15 * 60_000 },
  evidenceUpload: { limit: 5, windowMs: 60 * 60_000 },
  evidenceRead: { limit: 60, windowMs: 15 * 60_000 },
  // Voice processing bills a third-party provider on every call, so it is bounded
  // tightly. A per-user DAILY quota sits on top of this (see voicebuild/guard).
  voicebuild: { limit: 10, windowMs: 15 * 60_000 },
  // Abuse controls for text community actions.
  contentReport: { limit: 20, windowMs: 60 * 60_000 },
  // Share is anonymous by design (sharing shouldn't need an account) but it
  // increments the counter that feeds the TRENDING score — so unbounded it is a
  // one-line script for putting any thread at the top of the forum. Bounded per
  // IP+thread: generous for a human sharing to a few places, useless for a loop.
  threadShare: { limit: 10, windowMs: 60 * 60_000 },
} as const;
