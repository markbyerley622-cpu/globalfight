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
export function toFightStub(b: WikiBout, index: number): NormalizedFightStub {
  // Stable per-source ids so persist can match the winner back to a corner.
  const redExternalId = slugify(b.redName);
  const blueExternalId = slugify(b.blueName);
  const isDraw = /draw/i.test(b.method ?? "");
  const isNc = /no contest/i.test(b.method ?? "");
  const result: FightResult = !b.decided ? "SCHEDULED" : isNc ? "NO_CONTEST" : isDraw ? "DRAW" : "WIN";

  return {
    redName: b.redName,
    blueName: b.blueName,
    redExternalId,
    blueExternalId,
    weightClass: b.weightClass ?? undefined,
    titleFight: b.titleFight,
    mainEvent: index === 0, // Wikipedia lists the main event first
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
    fights: bouts.map(toFightStub),
    _meta: meta,
  };
}
