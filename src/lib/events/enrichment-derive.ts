// Pure derivation for the Event Enrichment engine. NO prisma, NO server-only —
// the IO wrapper (enrichment.ts) fetches; this module turns what was fetched into
// the derived signals (official result, hero selection, coverage terms, a
// completeness score). Kept pure so every rule here is unit-testable without a
// database — the same split that video-shape.ts and scoring.ts use.
//
// TRUTH RULE: every field produced here is read from stored data. Nothing is
// inferred, averaged, or invented. A completed event with no recorded winner
// yields null, never a guessed outcome.

import type { Article, Fight, FightMethod } from "@/lib/types";
import type { VideoRec } from "@/lib/feed/recommend";
import { winningCorner } from "@/lib/event-format";
import { shapeLabel } from "@/lib/feed/video-shape";
import { searchTerms, type EventEntities } from "@/lib/entities/resolve";

export type EventPhase = "pre" | "post";

export interface OfficialResult {
  /** null on a draw or no-contest (there is no winner to name). */
  winnerName: string | null;
  loserName: string | null;
  method?: FightMethod;
  round?: number;
  time?: string;
  titleFight: boolean;
  outcome: "win" | "draw" | "no-contest";
}

/**
 * The verified main-event outcome, or null when nothing is recorded yet.
 * Winner/loser come from the stored `winnerId` (via winningCorner), method and
 * round/time from their stored columns. A "SCHEDULED" (or otherwise undecided)
 * fight returns null — a completed event page then shows no result rather than a
 * fabricated one.
 */
export function officialResultFrom(fight: Fight | undefined | null): OfficialResult | null {
  if (!fight) return null;
  const base = {
    method: fight.method,
    round: fight.roundEnded,
    time: fight.timeEnded,
    titleFight: fight.titleFight,
  };
  if (fight.result === "DRAW")
    return { winnerName: null, loserName: null, outcome: "draw", ...base };
  if (fight.result === "NO_CONTEST")
    return { winnerName: null, loserName: null, outcome: "no-contest", ...base };

  const corner = winningCorner(fight);
  if (!corner) return null; // SCHEDULED / undetermined → nothing verified to show
  const winner = corner === "red" ? fight.red : fight.blue;
  const loser = corner === "red" ? fight.blue : fight.red;
  return { winnerName: winner.name, loserName: loser.name, outcome: "win", ...base };
}

/**
 * The one video to feature. On a completed card that is the top-ranked highlight
 * (the list is already phase-ordered, so highlights lead); before the card there
 * is no fight footage to feature, so this is null.
 */
export function selectHeroVideo(videos: VideoRec[], phase: EventPhase): VideoRec | null {
  if (phase !== "post") return null;
  return videos.find((v) => shapeLabel(v.title) === "Highlights") ?? null;
}

/**
 * How much verified material this enrichment carries, 0–100. This is a
 * COMPLETENESS signal (how populated the object is), NOT a truth-probability —
 * every included item is already evidence-backed. Consumers use it to decide how
 * rich a treatment an event can support (a hero needs a result and/or a
 * highlight; a bare event falls back to the plain layout).
 */
export function enrichmentConfidence(input: {
  phase: EventPhase;
  officialResult: OfficialResult | null;
  heroVideo: VideoRec | null;
  featuredCoverage: Article | null;
  coverageCount: number;
  videoCount: number;
}): number {
  let score = 0;
  // A completed card's spine is its result; an upcoming card can't have one, so
  // it isn't penalised for the absence.
  if (input.phase === "post") {
    if (input.officialResult) score += 40;
  } else {
    score += 20; // upcoming baseline — build-up material is the whole story pre-fight
  }
  if (input.heroVideo) score += 20;
  if (input.featuredCoverage) score += 20;
  if (input.coverageCount >= 3) score += 10;
  if (input.videoCount >= 2) score += 10;
  return Math.min(100, score);
}

// ── Card statistics ────────────────────────────────────────────────────────

export interface EventStats {
  boutCount: number;
  /** Bouts with a verified outcome recorded. */
  resolvedBoutCount: number;
  /**
   * Bouts on a card that has ALREADY HAPPENED and still carry no outcome. This
   * is the number that makes "results aren't in yet" an honest statement instead
   * of a shrug — and the number that shows an ingest gap the moment one opens.
   * Always 0 before the card.
   */
  pendingBoutCount: number;
  titleFightCount: number;
  coverageCount: number;
  videoCount: number;
}

/**
 * Counts over the card. Pure: `resolved` means a stored decisive/draw/no-contest
 * result, not an assumption that a past card must be finished.
 */
export function eventStats(
  fights: Fight[],
  phase: EventPhase,
  counts: { coverage: number; videos: number },
): EventStats {
  const decided = fights.filter((f) => f.result !== "SCHEDULED");
  return {
    boutCount: fights.length,
    resolvedBoutCount: decided.length,
    pendingBoutCount: phase === "post" ? fights.length - decided.length : 0,
    titleFightCount: fights.filter((f) => f.titleFight).length,
    coverageCount: counts.coverage,
    videoCount: counts.videos,
  };
}

// ── Navigation ─────────────────────────────────────────────────────────────

export interface EnrichmentSection {
  id: string;
  label: string;
  badge?: number;
}

export interface EnrichmentNavigation {
  href: string;
  /**
   * The single-scroll sections this event can actually support. Derived from what
   * enrichment FOUND, so a scroll-spy anchor is never reachable-but-empty — the
   * event page used to compute this inline, which is exactly the per-surface
   * re-derivation this engine exists to remove.
   */
  sections: EnrichmentSection[];
}

export function enrichmentNavigation(input: {
  slug: string;
  boutCount: number;
  coverageCount: number;
  videoCount: number;
}): EnrichmentNavigation {
  const media = input.coverageCount + input.videoCount;
  return {
    href: `/events/${input.slug}`,
    sections: [
      { id: "card", label: "Fight card", badge: input.boutCount },
      { id: "card-talk", label: "Card talk" },
      ...(media > 0 ? [{ id: "coverage", label: "Coverage", badge: media }] : []),
    ],
  };
}

/**
 * REGISTRY-FIRST coverage terms. Every term comes from a resolved entity's own
 * surface — canonical name, registry aliases, nickname, surname — plus the event
 * name. The promotion contributes its registry aliases rather than a hardcoded
 * table, and an unattributed event ("Various") contributes nothing, because there
 * is no organisation to search for.
 *
 * Weak forms are excluded by `searchTerms`: a `contains '%aj%'` scan would drag
 * the whole news table back. Weak forms are for scoring a candidate we already
 * have, never for widening the query that produced it.
 *
 * BOUNDED, and ordered so the bound is harmless. Every term becomes one
 * `title contains` branch in an OR (getArticlesMatchingDb), so an unbounded
 * surface across a 12-bout card would turn a cheap query into ~80 scans. The
 * budget therefore goes where coverage actually is:
 *
 *   1. the MAIN EVENT's full strong surface (aliases + nickname included) — this
 *      is what the widened surface was for
 *   2. one identifying form per undercard fighter — enough to FIND a story; the
 *      relevance pass then scores it against the complete surface anyway
 *   3. the promotion's registry aliases, then the event name
 *
 * So the query is no wider than the old surname-only version for the undercard,
 * and materially deeper exactly where it pays.
 */
export function coverageTermsFor(entities: EventEntities, eventName: string): string[] {
  const terms = new Set<string>();
  const add = (t: string) => {
    if (t.length >= MIN_TERM) terms.add(t);
  };

  const main = entities.main ? [entities.main.red, entities.main.blue] : [];
  const mainKeys = new Set(main.map(entityKey));
  for (const t of searchTerms(main, MIN_TERM)) add(t);

  for (const fighter of entities.fighters) {
    if (mainKeys.has(entityKey(fighter))) continue;
    // The surname is how a headline names an undercard fighter; the canonical
    // name is the fallback when the surname is too short to be a safe term.
    const surname = fighter.forms.find((f) => f.origin === "surname");
    add(surname ? surname.form : fighter.keys.canonical);
  }

  if (entities.promotion) for (const t of searchTerms([entities.promotion], MIN_TERM)) add(t);

  const evName = normalizeEventName(eventName);
  if (evName.length > 4) terms.add(evName);

  return [...terms].filter(Boolean).slice(0, MAX_COVERAGE_TERMS);
}

/**
 * Names to match VIDEO titles on, registry-first and bounded for the same reason
 * as the coverage terms: recommendVideos turns each one into a `title contains`
 * branch. The main event's full strong surface first (a highlight reel is titled
 * after the headline bout, often by nickname), then one form per undercard
 * fighter. recommendVideos additionally refuses anything shorter than its own
 * MIN_NAME, so short surnames drop there rather than matching half the catalog.
 */
export function videoMatchTerms(entities: EventEntities): string[] {
  const terms = new Set<string>();
  const main = entities.main ? [entities.main.red, entities.main.blue] : [];
  const mainKeys = new Set(main.map(entityKey));

  for (const t of searchTerms(main, MIN_TERM)) terms.add(t);
  for (const fighter of entities.fighters) {
    if (mainKeys.has(entityKey(fighter))) continue;
    if (fighter.keys.canonical) terms.add(fighter.keys.canonical);
  }
  return [...terms].slice(0, MAX_VIDEO_TERMS);
}

const MIN_TERM = 3;
/** One OR branch per term in the coverage query — keep the scan bounded. */
export const MAX_COVERAGE_TERMS = 40;
export const MAX_VIDEO_TERMS = 24;

const entityKey = (e: { id: string | null; name: string }) => e.id ?? `name:${e.name.toLowerCase()}`;

const normalizeEventName = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

const PROMO_ALIASES: Record<string, string[]> = {
  "one championship": ["one championship", "one fight night", "one friday fights", "onefc", "one fc"],
  bkfc: ["bkfc", "bare knuckle", "bare-knuckle"],
  adcc: ["adcc", "submission fighting"],
  ufc: ["ufc"],
  pfl: ["pfl", "professional fighters league"],
};

/**
 * The title-search terms that make an article "coverage" for this event: fighter
 * surnames on the card, the promotion (+ its aliases), and the event name. The DB
 * query (getEventCoverage) matches ANY term and returns [] when nothing matches —
 * so an event shows its own coverage or none, never a generic firehose.
 */
export function coverageTerms(promotion: string | undefined, fights: Fight[], eventName: string): string[] {
  const terms = new Set<string>();

  for (const f of fights) {
    for (const name of [f.red.name, f.blue.name]) {
      const surname = name.split(" ").pop()?.toLowerCase() ?? "";
      if (surname.length > 2) terms.add(surname);
    }
  }

  const promo = promotion?.toLowerCase().trim();
  if (promo && promo !== "various") {
    terms.add(promo);
    for (const alias of PROMO_ALIASES[promo] ?? []) terms.add(alias);
  }

  const evName = eventName.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (evName.length > 4) terms.add(evName);

  return [...terms].filter(Boolean);
}
