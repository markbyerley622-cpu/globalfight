// Types for the Wikipedia fight-card provider.
import type { NormalizedEvent } from "@/services/providers/types";
import type { Sport } from "@/lib/types";
import type { SearchStrategy, SearchStrategyKind } from "./search-strategies";
import type { ExpectedBout } from "./verify";

/**
 * How WE identify the event. Used to persist the harvested card onto the right row
 * (persistAggregated resolves by name + date) and NEVER sent to an external source.
 */
export interface EventIdentity {
  name: string;
  /** ISO date — passed straight through so persist resolves the same event. */
  date: string;
  sport: Sport;
}

/**
 * An event we want a card or a result for.
 *
 * The two identities are deliberately separate fields. Overloading one for both
 * jobs is what made every synthetic "Sport — DD Mon YYYY" card unresolvable: we
 * searched upstream for the string we use internally, and no source has heard of
 * it. See search-strategies.ts.
 */
export interface WikiTarget {
  /** For OUR database. */
  eventIdentity: EventIdentity;
  /** For the SOURCE — an ordered ladder, tried until one verifies. */
  searchIdentity: SearchStrategy[];
  /**
   * The bouts we are missing, resolved to registry entities. These are what a
   * candidate page is verified AGAINST (verify.ts) — a loose query is only safe
   * because acceptance is strict.
   */
  expectedBouts: ExpectedBout[];
}

/** What happened to one target — every outcome is nameable, none is silent. */
export interface WikiTargetOutcome {
  event: string;
  /** The strategy that produced a verified match, or null when none did. */
  strategy: SearchStrategyKind | null;
  /** The page title that verified, when one did. */
  page: string | null;
  /** Verified bouts on that page. */
  matched: number;
  /** Bouts parsed from that page (what we hand to persist). */
  bouts: number;
  /** Queries actually issued — the cost of this target. */
  queries: number;
  /** Why it ended as it did. */
  reason: "verified" | "no_candidate" | "no_card" | "unverified" | "error";
  note?: string;
}

export interface WikiHarvestReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  targets: number;
  /** Targets where at least one strategy returned a candidate page. */
  matched: number;
  /** Targets whose page yielded a VERIFIED card. */
  withCard: number;
  bouts: number;
  /** Total upstream queries issued across every strategy. */
  queries: number;
  /** How many targets each strategy resolved — proves the ladder earns its keep. */
  byStrategy: Record<string, number>;
  /** Per-target outcomes, for the repair report. */
  outcomes: WikiTargetOutcome[];
  warnings: string[];
}

export interface WikiHarvest {
  report: WikiHarvestReport;
  events: NormalizedEvent[];
}
