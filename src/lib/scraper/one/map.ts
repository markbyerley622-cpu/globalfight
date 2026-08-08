// ════════════════════════════════════════════════════════════════════════
//  ONE Championship — canonical mapping (pure). OneEvent → NormalizedEvent.
// ════════════════════════════════════════════════════════════════════════

import type { NormalizedEvent, NormalizedFightStub } from "@/services/providers/types";
import type { Sport, FightResult, FightMethod } from "@/lib/types";
import type { OneEvent, OneMatchup } from "./types";
import { parseMethod } from "../bkfc/normalize";
import { toRuleset, RULESET_CONFIDENCE } from "../ruleset";

export const ONE_SOURCE = "one";
export const ONE_CONFIDENCE = 0.9;

const METHODS = new Set<FightMethod>(["KO", "TKO", "UD", "SD", "MD", "SUB", "DQ", "RTD", "TD", "NC", "DRAW"]);

/** ONE's published wording → the enum, or undefined rather than a guess. */
function toMethod(raw: string | null): FightMethod | undefined {
  const token = parseMethod(raw);
  return token && METHODS.has(token as FightMethod) ? (token as FightMethod) : undefined;
}

/**
 * One ONE matchup → a canonical fight stub.
 *
 * ── The ruleset is READ, not derived ──────────────────────────────────────
 * ONE runs Muay Thai, kickboxing, MMA and submission grappling on the same
 * night, so the CARD's sport is false for most bouts on it — that is the defect
 * Fight.ruleset exists to fix, and it is why a provider must never re-derive a
 * ruleset from its event. ONE states it on the bout itself
 * ("Featherweight Muay Thai World Championship"), so it maps at `stated`
 * confidence. A label that names none leaves the field unset and the column
 * stays UNKNOWN, which a better source can close later.
 */
export function toOneFightStub(b: OneMatchup): NormalizedFightStub {
  const ruleset = toRuleset(b.label);
  const isDraw = /\bdraw\b/i.test(b.methodText ?? "");

  // Stated outcomes only. No winner sticker means ONE published no result —
  // an upcoming bout, or one whose card predates ONE's result archive — and
  // SCHEDULED is what that is. Inventing a result here would be indistinguishable
  // from having read one.
  const result: FightResult = b.winner
    ? "WIN"
    : b.noContest
      ? "NO_CONTEST"
      : isDraw
        ? "DRAW"
        : "SCHEDULED";

  const winnerExternalId =
    b.winner === "red" ? b.redExternalId : b.winner === "blue" ? b.blueExternalId : null;

  return {
    redName: b.redName,
    blueName: b.blueName,
    redExternalId: b.redExternalId ?? undefined,
    blueExternalId: b.blueExternalId ?? undefined,
    weightClass: b.weightClass ?? undefined,
    ...(ruleset
      ? {
          ruleset,
          rulesetConfidence: RULESET_CONFIDENCE.stated,
          rulesetSource: "one:bout-label",
        }
      : {}),
    titleFight: b.titleFight,
    // ONE emits the card main event first — verified on every numbered card
    // sampled, where the World Championship bout is block 0.
    mainEvent: b.order === 0,
    result,
    method: b.noContest ? "NC" : toMethod(b.methodText),
    roundEnded: b.round ?? undefined,
    winnerExternalId: winnerExternalId ?? undefined,
  };
}

export function toNormalizedOneEvent(e: OneEvent, lastUpdated: string): NormalizedEvent & { posterUrl?: string } {
  const isCode = !!e.country && /^[A-Za-z]{2}$/.test(e.country);
  return {
    externalId: e.slug,
    name: e.name,
    sport: e.sport as Sport,
    promotion: "ONE Championship",
    venue: e.venue ?? undefined,
    city: e.city ?? undefined,
    country: isCode ? undefined : e.country ?? undefined,
    countryCode: isCode ? e.country!.toUpperCase() : undefined,
    date: e.date ?? new Date(0).toISOString(),
    status: e.status,
    posterUrl: e.posterUrl ?? undefined,
    fights: e.bouts.map(toOneFightStub),
    _meta: { source: ONE_SOURCE, confidence: ONE_CONFIDENCE, lastUpdated, externalId: e.slug },
  };
}
