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
