// ════════════════════════════════════════════════════════════════════════════
//  RECONCILIATION — pure. Observations in, a decision out.
//
//  This is the module the whole evidence architecture exists for. Providers
//  record what they SAW; this decides what we BELIEVE, and it says why.
//
//  ── The rule ─────────────────────────────────────────────────────────────
//  A lower tier NEVER overwrites a higher one. Official beats encyclopaedic
//  beats aggregator beats internal — and the loser is not discarded, it stays in
//  the observation table and shows up as a recorded disagreement. The old
//  pipeline resolved the same precedence question by overwriting a single row,
//  so the losing value never landed and no conflict could even be detected.
//
//  ── Why staleness is a tier-INTERNAL rule, not a global one ──────────────
//  A three-month-old official ranking still outranks a Wikipedia edit from this
//  morning: the organisation publishing its own list is authoritative about its
//  own list, and Wikipedia being fresher does not make it right. Recency only
//  decides between observations AT THE SAME TIER — which is exactly the case it
//  is good at ("the UFC published a new board").
//
//  Pure so the whole decision table can be tested without a database, and so
//  two runs over the same evidence can never disagree.
// ════════════════════════════════════════════════════════════════════════════

export type Tier = "OFFICIAL" | "ENCYCLOPAEDIC" | "AGGREGATOR" | "INTERNAL";

/** Lower is stronger. The order IS the reconciliation rule. */
export const TIER_ORDER: Record<Tier, number> = {
  OFFICIAL: 0,
  ENCYCLOPAEDIC: 1,
  AGGREGATOR: 2,
  INTERNAL: 3,
};

/** Confidence published alongside a decision made at this tier. */
export const TIER_CONFIDENCE: Record<Tier, number> = {
  OFFICIAL: 1,
  ENCYCLOPAEDIC: 0.8,
  AGGREGATOR: 0.65,
  INTERNAL: 0.4,
};

/**
 * How long an observation stays usable.
 *
 * Not a freshness preference — a floor. A provider that went dark six months ago
 * should stop deciding what we publish, and without this the last thing a dead
 * source ever said would be served forever with full confidence. Generous
 * because sanctioning bodies genuinely republish slowly; the P4P board of a
 * small organisation can legitimately sit unchanged for months.
 */
export const MAX_AGE_DAYS = 120;

export interface Observation<T> {
  id: string;
  provider: string;
  tier: Tier;
  /** The source's OWN publication date, not our fetch time. */
  effectiveDate: Date;
  retrievedAt: Date;
  sourceUrl?: string | null;
  /** The claim itself — a rank, a titleholder, whatever is being decided. */
  value: T;
}

export interface Decision<T> {
  value: T;
  provider: string;
  tier: Tier;
  confidence: number;
  effectiveDate: Date;
  sourceUrl: string | null;
  /** How many DISTINCT providers asserted this same value. */
  agreementCount: number;
  /** True when at least one usable observation asserted something different. */
  contested: boolean;
  /** The observation ids behind the decision — its full audit trail. */
  observationIds: string[];
  /** Human-readable rationale for the admin conflict view. */
  reason: string;
}

export interface ReconcileOpts {
  now?: Date;
  maxAgeDays?: number;
  /** Compare two claims for equality. Defaults to strict equality. */
  equals?: <T>(a: T, b: T) => boolean;
}

/**
 * Order observations strongest first: tier, then the source's publication date,
 * then retrieval time, then id.
 *
 * The final id tiebreak is what makes this a TOTAL order. Without it two
 * observations identical on every other key could sort either way, and the
 * "deterministic" promise in the header would be false.
 */
function strongestFirst<T>(a: Observation<T>, b: Observation<T>): number {
  const tier = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
  if (tier !== 0) return tier;
  const effective = b.effectiveDate.getTime() - a.effectiveDate.getTime();
  if (effective !== 0) return effective;
  const retrieved = b.retrievedAt.getTime() - a.retrievedAt.getTime();
  if (retrieved !== 0) return retrieved;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Decide what to publish from a set of observations about ONE thing.
 *
 * Returns null when there is nothing usable — and null must be published as
 * "no data", never as a stale value or an invented one. That is the whole
 * difference between this and the pipeline it replaces.
 */
export function reconcile<T>(
  observations: Observation<T>[],
  opts: ReconcileOpts = {},
): Decision<T> | null {
  const now = opts.now ?? new Date();
  const maxAgeMs = (opts.maxAgeDays ?? MAX_AGE_DAYS) * 86_400_000;
  const equals = opts.equals ?? ((a: unknown, b: unknown) => a === b);

  const usable = observations.filter((o) => now.getTime() - o.effectiveDate.getTime() <= maxAgeMs);
  if (usable.length === 0) return null;

  const ranked = [...usable].sort(strongestFirst);
  const winner = ranked[0];

  // Everything that agrees with the winner, and everything that does not. Only
  // DISTINCT providers count toward agreement: one source publishing the same
  // list twice is not two sources agreeing, and counting it that way would let a
  // single provider manufacture consensus.
  const agreeing = ranked.filter((o) => equals(o.value, winner.value));
  const dissenting = ranked.filter((o) => !equals(o.value, winner.value));
  const agreementCount = new Set(agreeing.map((o) => o.provider)).size;

  return {
    value: winner.value,
    provider: winner.provider,
    tier: winner.tier,
    confidence: TIER_CONFIDENCE[winner.tier],
    effectiveDate: winner.effectiveDate,
    sourceUrl: winner.sourceUrl ?? null,
    agreementCount,
    contested: dissenting.length > 0,
    observationIds: agreeing.map((o) => o.id),
    reason: explain(winner, agreementCount, dissenting),
  };
}

function explain<T>(winner: Observation<T>, agreement: number, dissenting: Observation<T>[]): string {
  const base = `${winner.provider} (${winner.tier})`;
  if (dissenting.length === 0) {
    return agreement > 1 ? `${base}, ${agreement} providers agree` : base;
  }
  const losers = [...new Set(dissenting.map((o) => o.provider))].join(", ");
  return `${base} over ${losers}`;
}

/**
 * Reconcile a whole LIST — a division's ranking board.
 *
 * A ranking is not N independent decisions. Two providers publishing a division
 * publish an ORDER, and mixing them position by position produces a board that
 * neither source ever endorsed and that can contain the same fighter twice.
 *
 * So the winning PROVIDER is chosen once for the list, and its board is taken
 * whole. Other providers' boards still count toward agreement and disagreement,
 * which is what the admin conflict view reads — but they do not contribute rows.
 */
export function reconcileList<T extends { key: string }>(
  observations: Observation<T>[],
  opts: ReconcileOpts = {},
): { winner: Observation<T>[]; decision: Omit<Decision<null>, "value"> } | null {
  const now = opts.now ?? new Date();
  const maxAgeMs = (opts.maxAgeDays ?? MAX_AGE_DAYS) * 86_400_000;

  const usable = observations.filter((o) => now.getTime() - o.effectiveDate.getTime() <= maxAgeMs);
  if (usable.length === 0) return null;

  const ranked = [...usable].sort(strongestFirst);
  const best = ranked[0];
  // One provider's board = its observations sharing the winning publication.
  const winner = ranked.filter(
    (o) => o.provider === best.provider && o.effectiveDate.getTime() === best.effectiveDate.getTime(),
  );

  const others = [...new Set(ranked.filter((o) => o.provider !== best.provider).map((o) => o.provider))];
  const winningKeys = new Set(winner.map((o) => o.value.key));
  // "Contested" for a list means another provider published a DIFFERENT set of
  // entries — a different fighter ranked, not merely a different order, which is
  // the disagreement worth a moderator's attention.
  const contested = ranked.some(
    (o) => o.provider !== best.provider && !winningKeys.has(o.value.key),
  );

  return {
    winner,
    decision: {
      provider: best.provider,
      tier: best.tier,
      confidence: TIER_CONFIDENCE[best.tier],
      effectiveDate: best.effectiveDate,
      sourceUrl: best.sourceUrl ?? null,
      agreementCount: new Set(ranked.map((o) => o.provider)).size,
      contested,
      observationIds: winner.map((o) => o.id),
      reason: others.length ? `${best.provider} (${best.tier}) over ${others.join(", ")}` : `${best.provider} (${best.tier})`,
    },
  };
}
