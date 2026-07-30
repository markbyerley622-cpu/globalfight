// Types for the Wikipedia fight-card provider.
import type { NormalizedEvent } from "@/services/providers/types";
import type { Sport } from "@/lib/types";
import type { SearchStrategy, SearchStrategyKind } from "./search-strategies";
import type { ExpectedBout } from "./verify";
import type { WikiGap } from "./targets";

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
  /**
   * The Event row this target came from. Carried so a run can write its OUTCOME back
   * to that row (Event.resultAttempt*) — the harvester used to identify a target only
   * by event NAME, which is neither unique nor a key, so a per-event result could not
   * be recorded even though it was computed.
   */
  eventId: string;
  /** For OUR database. */
  eventIdentity: EventIdentity;
  /** For the SOURCE — an ordered ladder, tried until one verifies. */
  searchIdentity: SearchStrategy[];
  /**
   * The bouts we are missing, resolved to registry entities. These are what a
   * candidate page is verified AGAINST (verify.ts) — a loose query is only safe
   * because acceptance is strict — and what only ever gets persisted.
   *
   * EMPTY for a `missing_card` target by definition: the event has no bouts yet.
   * That gap is therefore accepted on its TITLE instead (verify.ts::verifyTitle).
   */
  expectedBouts: ExpectedBout[];
  /**
   * Which gap this target is filling. It decides the acceptance rule, so it is part
   * of the target rather than something the caller has to remember to pass.
   */
  gap: WikiGap;
  /** Canonical promotion name, or null — a candidate-scoring signal. */
  promotionName: string | null;
  /** Registry aliases for the promotion ("bare knuckle" finds far more than "BKFC"). */
  promotionAliases: string[];
}

/** Per-rung retrieval stats, so a bad strategy is measurable rather than assumed. */
export interface StrategyStat {
  /** Queries issued on this rung. */
  searched: number;
  /** Candidate titles the source returned. */
  candidates: number;
  /** Candidates that scored highly enough to fetch + parse. */
  parsed: number;
  /** Targets this rung actually resolved. */
  verified: number;
}

/**
 * One decision the pipeline made, in order. Recorded always (it is a handful of
 * strings) and printed on demand — `--explain`.
 *
 * The reason this exists: a run could report "targets=2 verified=0" and there was no
 * way to tell WHICH of four very different things had happened — the search found
 * nothing, it found something and scoring refused it, a page parsed to no card, or a
 * card parsed but wasn't our bout. Those need opposite responses, and guessing
 * between them is what turned a data question into an architecture rewrite.
 */
export interface TraceStep {
  stage: "target" | "search" | "candidate" | "fetch" | "parse" | "verify" | "accept" | "reject" | "budget" | "result";
  ok: boolean;
  detail: string;
}

/** What happened to one target — every outcome is nameable, none is silent. */
export interface WikiTargetOutcome {
  /** The Event row, so the outcome can be written back to it. */
  eventId: string;
  event: string;
  /** The strategy that produced a verified match, or null when none did. */
  strategy: SearchStrategyKind | null;
  /** The page title that verified, when one did. */
  page: string | null;
  /** Verified bouts on that page. */
  matched: number;
  /** Bouts actually handed to persist — verified only, never a season page's superset. */
  bouts: number;
  /** Bouts the accepted page contained in total (bouts < parsedOnPage means we filtered). */
  parsedOnPage?: number;
  /** Queries actually issued — the cost of this target. */
  queries: number;
  /** Pages fetched + parsed. Bounded by PARSE_BUDGET. */
  parses: number;
  /** Candidates refused on their title, before any fetch. */
  rejected: number;
  /** A sample of those rejections with their scores — retrieval, made explainable. */
  rejectedDetail: { title: string; score: number; reasons: string[] }[];
  /** The accepted candidate's score and the signals behind it. */
  score?: number;
  reasons?: string[];
  /** The page SHAPE that was accepted — season page, event page, fighter bio, … */
  candidateKind?: string;
  /** How many bouts this target was looking for. */
  expectedBouts?: number;
  /** `matched / expectedBouts`, as a whole percentage. The completeness metric. */
  coveragePct?: number;
  /**
   * Why it ended as it did.
   *
   * `verified` means the event was RECONSTRUCTED — coverage reached
   * COVERAGE_THRESHOLD. `partial` means real, correct bouts were found and persisted
   * but the card is not complete, so it stays eligible for another attempt.
   *
   * The distinction exists because "found a matching page" was previously reported as
   * verified: a 13-bout card that harvested 1 bout from a fighter's biography counted
   * as a success, and the queue then de-prioritised it.
   */
  reason: "verified" | "partial" | "no_candidate" | "all_rejected" | "no_card" | "unverified" | "error";
  note?: string;
  /** Every decision, in order — the `--explain` trace. */
  trace: TraceStep[];
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
  /** Pages fetched + parsed. The number that used to be "every search result". */
  parses: number;
  /** Candidates refused on their title before any fetch — the saved work. */
  rejected: number;
  /** Page-cache hits: the same season page reused instead of re-downloaded. */
  cacheHits: number;
  /** searched / candidates / parsed / verified per rung — the ladder, measured. */
  byStrategy: Record<string, StrategyStat>;
  /** Per-target outcomes, for the repair report. */
  outcomes: WikiTargetOutcome[];
  warnings: string[];
}

export interface WikiHarvest {
  report: WikiHarvestReport;
  events: NormalizedEvent[];
}
