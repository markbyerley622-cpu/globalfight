import "server-only";
import { cache } from "react";
import { queryCurrentPicks, queryRecentResults } from "./queries";
import type { ProfileOverview, OverviewOptions } from "./types";

export * from "./types";

// ════════════════════════════════════════════════════════════════════════════
//  THE PROFILE SERVICE — one entry point for everything a profile renders.
//
//  ── Why a service and not two page-level queries ─────────────────────────
//  There are already two profiles (your own at /profile, everyone else's at
//  /u/<handle>) and a third surface at /predictions/mine. Each new section that
//  lands — Activity, Statistics, Achievements, favourites — would otherwise be
//  written three times and drift twice. This is the single place that knows how
//  to read a member's predictions.
//
//  ── Shaped for the sections that are NOT built yet ───────────────────────
//  Each section is an independent fetcher; `getProfileOverview` composes them.
//  Adding the Activity Feed later is a new `queryActivity`, a field on the
//  overview and one entry in the Promise.all below — no page changes, no
//  refactor. That is the whole reason this exists now rather than after the
//  third section made it unavoidable.
//
//  ── Request-level memoisation ────────────────────────────────────────────
//  Wrapped in React `cache`, so the public profile calling it and any component
//  underneath asking again share one execution per request. The existing
//  `getProfileStats` already uses the same pattern; this matches it rather than
//  introducing a second caching idea.
// ════════════════════════════════════════════════════════════════════════════

/** Preview sizes. The profile shows a SNAPSHOT; "View all" is the full list. */
export const OVERVIEW_DEFAULTS = {
  /** Enough to show a real slate without turning the profile into a list page. */
  currentLimit: 6,
  /** Settled picks CONSIDERED — they then collapse into far fewer event groups. */
  resultLimit: 12,
} as const;

async function loadOverview(userId: string, opts: OverviewOptions = {}): Promise<ProfileOverview> {
  const currentLimit = opts.currentLimit ?? OVERVIEW_DEFAULTS.currentLimit;
  const resultLimit = opts.resultLimit ?? OVERVIEW_DEFAULTS.resultLimit;

  // Concurrent: the two sections share nothing, so page latency is the slower
  // of them rather than their sum.
  const [current, results] = await Promise.all([
    queryCurrentPicks(userId, currentLimit),
    queryRecentResults(userId, resultLimit),
  ]);

  return {
    currentPicks: current.picks,
    moreCurrent: current.more,
    recentResults: results.groups,
    moreResults: results.more,
  };
}

/**
 * Everything the profile's prediction sections need, in one call.
 *
 * `cache` keys on the arguments, so passing an options object built inline is
 * safe only because the object is compared by identity — callers should pass
 * the same shape (or none) rather than a fresh literal per component. The page
 * calls this once and passes the result down, which is the intended use.
 */
export const getProfileOverview = cache(loadOverview);

/** The two filters /predictions/mine accepts, shared so the links cannot rot. */
export const PREDICTION_FILTERS = { active: "active", completed: "completed" } as const;
export type PredictionFilter = (typeof PREDICTION_FILTERS)[keyof typeof PREDICTION_FILTERS];

/**
 * "View all" destinations.
 *
 * Both point at the EXISTING /predictions/mine, which already renders a
 * member's full record — building a second list page would be two
 * implementations of the same screen. Centralised here so the profile sections
 * cannot disagree with the page about what the query param is called.
 */
export const viewAllHref = (filter: PredictionFilter) => `/predictions/mine?filter=${filter}`;
