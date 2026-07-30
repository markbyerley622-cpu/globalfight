// ════════════════════════════════════════════════════════════════════════
//  Wikipedia cards → canonical NormalizedEvent (pure).
//
//  Wikipedia is the only source that carries bout RESULTS (method/round) for
//  BKFC/ONE, so this is what fills `result`, `method`, `roundEnded` and the
//  winner. Attribution is required (CC BY-SA) — see the ingestion registry.
// ════════════════════════════════════════════════════════════════════════

import type {
  NormalizedEvent,
  NormalizedFightStub,
  SourceMeta,
} from "@/services/providers/types";
import type { FightResult, FightMethod } from "@/lib/types";
import type { VerifiedBout } from "./verify";
import { slugify } from "@/lib/utils";
import { parseMethod } from "../bkfc/normalize";
import type { WikiBout } from "./extract";
import type { EventIdentity } from "./types";

export const WIKI_SOURCE = "wikipedia";
/** Editorially maintained + cited, but community-edited: below an official feed. */
export const WIKI_CONFIDENCE = 0.75;

const METHODS = new Set<FightMethod>(["KO", "TKO", "UD", "SD", "MD", "SUB", "DQ", "RTD", "TD", "NC", "DRAW"]);

function toMethod(raw: string | null): FightMethod | undefined {
  const token = parseMethod(raw);
  return token && METHODS.has(token as FightMethod) ? (token as FightMethod) : undefined;
}

/** One Wikipedia bout row → a canonical fight stub. */
export function toFightStub(b: WikiBout, index: number, isFullCard = true): NormalizedFightStub {
  // ── Persist against OUR fighter, not the source's spelling ────────────────
  //
  // These were `slugify(b.redName)` and `b.redName` — the SOURCE's name form. When
  // the source spells a fighter differently, resolveFighter() matched neither the
  // externalId nor the name, so it CREATED A NEW FIGHTER and a new fight, leaving
  // ours pending. Observed in production: Wikipedia lists "Ricardo Salas", we hold
  // "Ricardo Salas Rodriguez"; the card went from 2 bouts to 3 with Richardson
  // Hitchins appearing twice against two different "Salas" records.
  //
  // verifyCard already resolved both corners to our entities to accept the page at
  // all — `ourRedName`/`ourRedSlug` is that same resolution, reused instead of
  // discarded. Falls back to the source form for a card-gap bout, which by
  // definition has no expected bout to have been resolved against.
  const v = b as Partial<VerifiedBout>;
  const redName = v.ourRedName ?? b.redName;
  const blueName = v.ourBlueName ?? b.blueName;
  const redExternalId = v.ourRedSlug ?? slugify(redName);
  const blueExternalId = v.ourBlueSlug ?? slugify(blueName);
  const isDraw = /draw/i.test(b.method ?? "");
  const isNc = /no contest/i.test(b.method ?? "");
  const result: FightResult = !b.decided ? "SCHEDULED" : isNc ? "NO_CONTEST" : isDraw ? "DRAW" : "WIN";

  return {
    redName,
    blueName,
    redExternalId,
    blueExternalId,
    weightClass: b.weightClass ?? undefined,
    titleFight: b.titleFight,
    // Wikipedia lists the main event first — but ONLY when we are taking a whole card.
    //
    // A result-gap run persists just the VERIFIED SUBSET, often a single bout, whose
    // index is 0 by construction. So every harvested bout was flagged mainEvent and a
    // three-bout card rendered "Main event" three times. `isFullCard` is false for the
    // result gap, where the event already has its own main event and this run has no
    // business reassigning it.
    mainEvent: isFullCard && index === 0,
    result,
    method: toMethod(b.method),
    roundEnded: b.round ?? undefined,
    // "def." means the LEFT (red) fighter won.
    winnerExternalId: result === "WIN" ? redExternalId : undefined,
  };
}

/**
 * Build a canonical event carrying the Wikipedia-sourced card.
 *
 * `event` is the EVENT IDENTITY — our own name and date, never the page title we
 * found it under. That separation is the point: a synthetic card is located upstream
 * by its bout ("Errol Spence Jr vs Tim Tszyu") but must persist onto the row we
 * already have ("Boxing — 26 Jul 2026"), or the result lands on a new event and the
 * predictions it was meant to settle never see it.
 */
export function toNormalizedWikiEvent(
  event: EventIdentity,
  pageTitle: string,
  bouts: WikiBout[],
  lastUpdated: string,
  /**
   * True only for a CARD-gap harvest, where the whole parsed card is legitimately
   * this event's. False for a result gap, which persists a verified subset and must
   * not reassign the event's main event — see toFightStub.
   */
  isFullCard = true,
): NormalizedEvent {
  // The source's identifier for THIS EVENT — the page it came from, qualified by the
  // event itself. The page alone is NOT an event id: a Wikipedia season page
  // ("2026 in Bare Knuckle Fighting Championship") is the right source for every BKFC
  // card of the year, so using the bare title made a dozen events share one
  // externalId. resolveEvent checks externalId FIRST, so the second and third events
  // resolved to whichever one persisted first — every result landing on one event and
  // the rest left unresolved. Composing keeps provenance honest and identity unique.
  const externalId = `${pageTitle}#${event.name}@${event.date.slice(0, 10)}`;
  const meta: SourceMeta = {
    source: WIKI_SOURCE,
    confidence: WIKI_CONFIDENCE,
    lastUpdated,
    externalId,
  };
  return {
    externalId,
    name: event.name,
    sport: event.sport,
    date: event.date,
    fights: bouts.map((b, i) => toFightStub(b, i, isFullCard)),
    _meta: meta,
  };
}
