// Deterministic pseudo-randomness + time helpers for the seed world.
// A fixed seed makes `npm run seed:demo` reproducible: the same believable world
// every run, so demos and screenshots are stable. Override with SEED_RNG=<int>.

const SEED = Number(process.env.SEED_RNG ?? 20260721) >>> 0;

/** mulberry32 — tiny, fast, good-enough PRNG. */
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next: () => number;
  constructor(seed = SEED) {
    this.next = mulberry32(seed);
  }
  /** float in [0,1). */
  float(): number {
    return this.next();
  }
  /** integer in [min,max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  /** true with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }
  /** uniform pick. */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  /** n distinct picks (or all, if n exceeds length), order randomised. */
  sample<T>(arr: readonly T[], n: number): T[] {
    return this.shuffle(arr).slice(0, Math.max(0, Math.min(n, arr.length)));
  }
  /** Fisher–Yates copy. */
  shuffle<T>(arr: readonly T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  /** weighted pick — items paired with positive weights. */
  weighted<T>(items: readonly { value: T; weight: number }[]): T {
    const total = items.reduce((s, i) => s + i.weight, 0);
    let r = this.next() * total;
    for (const it of items) {
      r -= it.weight;
      if (r <= 0) return it.value;
    }
    return items[items.length - 1].value;
  }
  /** gaussian-ish via averaging, clamped to [min,max]. */
  gauss(min: number, max: number): number {
    const r = (this.next() + this.next() + this.next()) / 3;
    return min + r * (max - min);
  }
}

const DAY = 86_400_000;

/**
 * A believable moment in the past `withinDays`, biased toward the natural rhythm
 * of a sports-fan audience: quiet overnight, a lunch bump, a heavy evening peak.
 * Used to spread activity so the world never looks like everyone acted at once.
 */
export function pastMoment(rng: Rng, withinDays: number, now: number): Date {
  const dayOffset = Math.floor(rng.gauss(0, withinDays));
  // Daypart weighting (local-ish hours): evening dominates, then lunch, then morning.
  const hour = rng.weighted([
    { value: rng.int(7, 9), weight: 2 }, // morning check
    { value: rng.int(12, 13), weight: 3 }, // lunch
    { value: rng.int(18, 23), weight: 6 }, // evening / fight-night peak
    { value: rng.int(0, 6), weight: 1 }, // night owls
    { value: rng.int(14, 17), weight: 2 }, // afternoon
  ]);
  const minute = rng.int(0, 59);
  const d = new Date(now - dayOffset * DAY);
  d.setHours(hour, minute, rng.int(0, 59), 0);
  return d.getTime() > now ? new Date(now - rng.int(1, 90) * 60_000) : d;
}

export const daysAgo = (n: number, now: number): Date => new Date(now - n * DAY);
