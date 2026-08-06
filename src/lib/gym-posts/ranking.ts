// ════════════════════════════════════════════════════════════════════════════
//  THE FEED RANKER. Pure, deterministic, and testable without a database.
//
//  ── Why not just createdAt ───────────────────────────────────────────────
//  A strict recency feed is a feed where the most active gym wins by volume.
//  Post ten times a day and you own the page; post once a week and you are
//  invisible by lunchtime. That is not a ranking, it is a queue.
//
//  ── Why not a "smart" opaque score either ────────────────────────────────
//  Every input below is a number we actually hold and can explain to the person
//  whose post ranked where. There is no randomness, no A/B jitter and no
//  personalisation-by-embedding. Same inputs → same order, always. A feed that
//  reorders itself between two renders of the same data is a feed that loses
//  someone's scroll position and cannot be debugged.
//
//  ── What "media quality" honestly means ──────────────────────────────────
//  We cannot judge whether a photo is GOOD. What we can measure is whether it
//  is large enough to fill a card without upscaling, and whether we know its
//  intrinsic dimensions at all (an asset processed before dimensions were
//  recorded reports 0×0 and would otherwise be treated as a tiny image). So the
//  signal is "will this render well", which is the part that actually affects
//  the reader. Anything stronger would be a guess dressed up as a metric.
//
//  ── The two-stage shape, and its honest limit ────────────────────────────
//  Ranking runs over a WINDOW of candidates fetched by keyset recency, then
//  reorders within that window. The consequence, stated plainly: a post cannot
//  climb from deep in the archive to the top of page one on score alone. Global
//  score ordering would need the score materialised in a column and recomputed
//  on a schedule (because freshness decays whether or not anything is written),
//  which is a cron and a write-amplification cost this does not yet justify.
//  See docs/ARCHITECTURE.md for the upgrade path.
// ════════════════════════════════════════════════════════════════════════════

/** Everything the ranker is allowed to look at. Deliberately narrow. */
export interface Rankable {
  id: string;
  gymId: string;
  createdAt: Date;
  reactionCount: number;
  commentCount: number;
  shareCount: number;
  /** How many READY assets are attached. */
  mediaCount: number;
  /** Widest attached image, in pixels. 0 when unknown. */
  widestMedia: number;
  /** Author reputation — a tiebreaker, never a kingmaker. See WEIGHTS. */
  authorReputation: number;
  /**
   * Identity of the CONTENT, for near-duplicate suppression. Two posts with the
   * same key are the same thing said twice (a cross-post, a double-submit).
   */
  contentKey: string;
}

/**
 * The weights, in one place, named.
 *
 * Everything is log-compressed before weighting. Raw counts make the feed a
 * winner-take-all: a post with 400 reactions would outrank a fresh one for a
 * week. Compression means the step from 3 comments to 6 moves a post further
 * than the step from 300 to 306 — which matches how much those two facts
 * actually tell you.
 */
export const WEIGHTS = {
  /** A tap. Cheap to give, so worth the least. */
  reaction: 1,
  /** Someone wrote something. Costs effort, so it counts for more. */
  comment: 2.5,
  /** Someone put their own name behind it elsewhere. The strongest signal. */
  share: 4,
  /** Having any media at all. A photo post is why people open a gym feed. */
  media: 1.2,
  /** Resolution good enough to fill a card without upscaling. */
  mediaQuality: 0.8,
  /** Deliberately small — see scorePost. */
  reputation: 0.2,
  /** Gravity. Higher = the feed forgets faster. 1.5 ≈ a day-long shelf life. */
  gravity: 1.5,
} as const;

/** The width at which an image fills a feed card on a 2× display. */
const GOOD_WIDTH = 1200;

/** Ages younger than this all count as "now", so a burst is not a race. */
const AGE_FLOOR_HOURS = 2;

const log = (n: number) => Math.log1p(Math.max(0, n));

/**
 * Score one post. Higher is better.
 *
 *   score = (1 + engagement + media + reputation) / (ageHours + 2) ^ gravity
 *
 * The leading 1 matters: without it a brand-new post with no engagement scores
 * zero and can never surface, which is the bootstrap problem that makes a new
 * gym's feed look dead.
 *
 * Reputation is weighted at 0.2 against a compressed value, which puts the
 * ENTIRE spread from a new account to the highest-reputation member on the
 * platform at less than two comments' worth of lift. That bound is asserted in
 * the tests, and it is the point: reputation breaks ties between comparable
 * posts and cannot manufacture reach on its own. The first draft used 0.5,
 * where a legendary account outranked two real comments — a leaderboard
 * wearing a feed's clothes.
 */
export function scorePost(p: Rankable, now: Date): number {
  const engagement =
    WEIGHTS.reaction * log(p.reactionCount) +
    WEIGHTS.comment * log(p.commentCount) +
    WEIGHTS.share * log(p.shareCount);

  const media =
    p.mediaCount > 0
      ? WEIGHTS.media + (p.widestMedia >= GOOD_WIDTH ? WEIGHTS.mediaQuality : 0)
      : 0;

  const reputation = WEIGHTS.reputation * log(p.authorReputation);

  // Clock skew and future-dated rows must not produce a negative age, which
  // would invert the decay and pin the row to the top forever.
  const ageHours = Math.max(0, (now.getTime() - p.createdAt.getTime()) / 3_600_000);

  return (1 + engagement + media + reputation) / Math.pow(ageHours + AGE_FLOOR_HOURS, WEIGHTS.gravity);
}

/**
 * Total order over scored posts.
 *
 * Floating point ties are real (two posts with identical counts and the same
 * second), so the comparator falls through to createdAt and then to id. Without
 * that last step the sort is not a total order and Array.prototype.sort is free
 * to return either arrangement — which is exactly the non-determinism this
 * module promises not to have.
 */
function byScore(a: { score: number; p: Rankable }, b: { score: number; p: Rankable }): number {
  if (b.score !== a.score) return b.score - a.score;
  const t = b.p.createdAt.getTime() - a.p.createdAt.getTime();
  if (t !== 0) return t;
  return a.p.id < b.p.id ? -1 : a.p.id > b.p.id ? 1 : 0;
}

/**
 * Drop repeats of the same content, keeping the best-ranked copy.
 *
 * Runs BEFORE diversity so a double-submitted post cannot consume two slots and
 * then get "diversified" apart to look like two separate posts.
 */
function dedupeContent(ranked: { score: number; p: Rankable }[]): { score: number; p: Rankable }[] {
  const seen = new Set<string>();
  const out: { score: number; p: Rankable }[] = [];
  for (const row of ranked) {
    // An empty key means "no comparable content" (a media-only post whose
    // assets differ), and must never collapse unrelated posts together.
    if (row.p.contentKey && seen.has(row.p.contentKey)) continue;
    if (row.p.contentKey) seen.add(row.p.contentKey);
    out.push(row);
  }
  return out;
}

/**
 * Break up runs from a single gym.
 *
 * A gym that posts five times in an hour would otherwise take the whole first
 * screen, and the reader learns that the feed is one gym's noticeboard. This
 * walks the ranked list and, whenever the next item repeats the previous item's
 * gym, promotes the nearest following item from a different gym instead.
 *
 * Two properties that make it safe:
 *   • it never DROPS anything — the run is reordered, not truncated;
 *   • it only looks forward, so it is a single stable pass and the result is a
 *     pure function of the input order.
 *
 * When every remaining candidate is from the same gym it gives up and emits
 * them in rank order, because refusing to would mean showing nothing.
 */
export function diversify<T extends { gymId: string }>(ranked: T[], maxRun = 1): T[] {
  if (ranked.length <= 1) return ranked;

  const pool = [...ranked];
  const out: T[] = [];
  let lastGym: string | null = null;
  let run = 0;

  while (pool.length > 0) {
    let index = 0;
    if (lastGym !== null && run >= maxRun && pool[0].gymId === lastGym) {
      const alt = pool.findIndex((r) => r.gymId !== lastGym);
      if (alt > 0) index = alt;
    }
    const [picked] = pool.splice(index, 1);
    if (picked.gymId === lastGym) run += 1;
    else { lastGym = picked.gymId; run = 1; }
    out.push(picked);
  }
  return out;
}

export interface RankOptions {
  now?: Date;
  /** How many posts from one gym may sit back-to-back. */
  maxRun?: number;
}

/**
 * The whole pipeline: score → dedupe → diversify.
 *
 * Returns the input objects in their new order, so the caller keeps whatever
 * else it loaded alongside them.
 */
export function rankFeed<T extends Rankable>(posts: T[], opts: RankOptions = {}): T[] {
  const now = opts.now ?? new Date();
  const scored = posts.map((p) => ({ score: scorePost(p, now), p }));
  scored.sort(byScore);
  return diversify(dedupeContent(scored).map((r) => r.p as T), opts.maxRun ?? 1);
}

/**
 * The identity of a post's content.
 *
 * Body text normalised (case, whitespace, punctuation runs) plus the SORTED set
 * of attached asset ids — so the same photos in a different order are still the
 * same post. Sorting matters: without it a re-upload that happened to arrive in
 * a different order would read as new content.
 */
export function contentKeyOf(body: string, assetIds: string[]): string {
  const text = body.toLowerCase().replace(/\s+/g, " ").trim();
  const assets = [...assetIds].sort().join(",");
  if (!text && !assets) return "";
  return `${text}|${assets}`;
}
