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
import type { Sport, FightResult, FightMethod } from "@/lib/types";
import { slugify } from "@/lib/utils";
import { parseMethod } from "../bkfc/normalize";
import type { WikiBout } from "./extract";

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

/** Build a canonical event carrying the Wikipedia-sourced card. */
export function toNormalizedWikiEvent(
  event: { name: string; date: string; sport: Sport },
  pageTitle: string,
  bouts: WikiBout[],
  lastUpdated: string,
): NormalizedEvent {
  const meta: SourceMeta = {
    source: WIKI_SOURCE,
    confidence: WIKI_CONFIDENCE,
    lastUpdated,
    externalId: pageTitle,
  };
  return {
    externalId: pageTitle,
    name: event.name,
    sport: event.sport,
    date: event.date,
    fights: bouts.map(toFightStub),
    _meta: meta,
  };
}
