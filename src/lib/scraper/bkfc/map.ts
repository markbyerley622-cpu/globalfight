// ════════════════════════════════════════════════════════════════════════
//  BKFC provider — canonical mapping (pure).
//
//  Converts the raw Bkfc* extraction shapes into the repository's canonical
//  Normalized* DTOs (src/services/providers/types.ts), tagged with SourceMeta
//  provenance. No DB, no Prisma, no side effects — this is the provider's
//  transformation boundary. The shared pipeline (services/sync/persist.ts)
//  consumes these and owns identity resolution + writes.
// ════════════════════════════════════════════════════════════════════════

import type {
  NormalizedEvent,
  NormalizedFighter,
  NormalizedRanking,
  NormalizedArticle,
  NormalizedFightStub,
  NormalizedRankingEntry,
  SourceMeta,
} from "@/services/providers/types";
import type { Sport, FightResult, FightMethod } from "@/lib/types";
import type { BkfcEvent, BkfcFighter, BkfcRankingRow, BkfcArticle } from "./types";
import { parseMethod } from "./normalize";
import { toRuleset, RULESET_CONFIDENCE } from "../ruleset";

export const BKFC_SPORT: Sport = "BARE_KNUCKLE";
export const BKFC_SOURCE = "bkfc"; // DataSource.key / provenance source
/** BKFC is the official promotion site → high trust for its own records. */
export const BKFC_CONFIDENCE = 0.9;
/** BKFC's standard bout length (5 two-minute rounds). Domain constant. */
export const BKFC_DEFAULT_ROUNDS = 5;

function meta(externalId: string, lastUpdated: string): SourceMeta {
  return { source: BKFC_SOURCE, confidence: BKFC_CONFIDENCE, lastUpdated, externalId };
}

/** BkfcFighter → NormalizedFighter. */
export function toNormalizedFighter(f: BkfcFighter, lastUpdated: string): NormalizedFighter {
  return {
    externalId: f.slug,
    name: f.name,
    nickname: f.nickname ?? undefined,
    aliases: f.nickname ? [f.nickname] : undefined,
    sport: BKFC_SPORT,
    nationality: f.nationality ?? undefined,
    heightCm: f.heightCm ?? undefined,
    reachCm: f.reachCm ?? undefined,
    stance: f.stance ?? undefined,
    wins: f.record?.wins,
    losses: f.record?.losses,
    draws: f.record?.draws,
    noContests: f.record?.noContests,
    imageUrl: f.imageUrl ?? undefined,
    _meta: meta(f.slug, lastUpdated),
  };
}

const METHODS = new Set<FightMethod>(["KO", "TKO", "UD", "SD", "MD", "SUB", "DQ", "RTD", "TD", "NC", "DRAW"]);

/** BKFC's published wording → the enum, or undefined rather than a guess. */
function toMethod(raw: string | null): FightMethod | undefined {
  const token = parseMethod(raw);
  return token && METHODS.has(token as FightMethod) ? (token as FightMethod) : undefined;
}

function toFightStub(e: BkfcEvent, b: BkfcEvent["bouts"][number]): NormalizedFightStub {
  const winnerExternalId =
    b.winnerCorner === "red" ? (b.redSlug ?? undefined) : b.winnerCorner === "blue" ? (b.blueSlug ?? undefined) : undefined;

  // ── The result, only where the FEED stated one ──────────────────────────
  // A card parsed from the DOM alone still carries null results, and null here
  // means SCHEDULED — which is the truth for an upcoming card and stays the
  // truth for a completed one the feed could not be read for. Nothing below
  // infers an outcome from the event being in the past.
  const decided = b.winnerCorner !== null;
  const isDraw = b.redResult === "draw" || b.blueResult === "draw";
  const isNc = b.redResult === "no contest" || b.blueResult === "no contest";
  const stated = decided || isDraw || isNc;
  const result: FightResult | undefined = !stated
    ? undefined
    : isNc
      ? "NO_CONTEST"
      : isDraw
        ? "DRAW"
        : "WIN";

  // The ruleset AS STATED on the bout ("BARE KNUCKLE BOXING"), never derived
  // from the promotion. BKFC's own feed names it per bout, so a card that ever
  // runs a different ruleset records it correctly instead of inheriting BKFC's.
  const ruleset = toRuleset(b.ruleset ?? null);

  return {
    redName: b.redName,
    blueName: b.blueName,
    redExternalId: b.redSlug ?? undefined,
    blueExternalId: b.blueSlug ?? undefined,
    weightClass: b.weightClass ?? undefined,
    scheduledRounds: b.scheduledRounds ?? BKFC_DEFAULT_ROUNDS,
    titleFight: b.titleFight,
    mainEvent: b.mainEvent,
    ...(ruleset
      ? {
          ruleset,
          rulesetConfidence: RULESET_CONFIDENCE.stated,
          rulesetSource: "bkfc:bout-rules",
        }
      : {}),
    ...(result ? { result } : {}),
    method: isNc ? "NC" : isDraw ? "DRAW" : toMethod(b.method),
    roundEnded: b.roundEnded ?? undefined,
    // Only a decided bout names a winner; a draw or NC deliberately names none.
    winnerExternalId: result === "WIN" ? winnerExternalId : undefined,
  };
}

/** BkfcEvent → NormalizedEvent (posterUrl carried as an extra field persist.ts reads). */
export function toNormalizedEvent(e: BkfcEvent, lastUpdated: string): NormalizedEvent & { posterUrl?: string } {
  return {
    externalId: e.slug,
    name: e.name,
    sport: BKFC_SPORT,
    promotion: "BKFC",
    venue: e.venue ?? undefined,
    city: e.city ?? undefined,
    country: e.country ?? undefined,
    date: e.date ?? new Date(0).toISOString(), // required; unknown → epoch sentinel
    status: e.status,
    posterUrl: e.posterUrl ?? undefined,
    fights: e.bouts.map((b) => toFightStub(e, b)),
    _meta: meta(e.slug, lastUpdated),
  };
}

/** Ranking rows (already flattened) → one NormalizedRanking for the sport. */
export function toNormalizedRanking(rows: BkfcRankingRow[], lastUpdated: string): NormalizedRanking {
  const entries: NormalizedRankingEntry[] = rows.map((r) => ({
    weightClass: r.division,
    isPoundForPound: false,
    rank: r.rank,
    fighterName: r.fighterName,
    fighterExternalId: r.fighterSlug ?? undefined,
  }));
  return { sport: BKFC_SPORT, entries, _meta: meta("bkfc-rankings", lastUpdated) };
}

/** BkfcArticle → NormalizedArticle. */
export function toNormalizedArticle(a: BkfcArticle, lastUpdated: string): NormalizedArticle {
  return {
    externalId: a.slug,
    title: a.title,
    excerpt: a.excerpt ?? undefined,
    url: a.url,
    imageUrl: a.coverImageUrl ?? undefined,
    publishedAt: a.publishedAt ?? lastUpdated,
    _meta: meta(a.slug, lastUpdated),
  };
}
