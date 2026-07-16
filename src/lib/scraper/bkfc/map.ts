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
import type { Sport } from "@/lib/types";
import type { BkfcEvent, BkfcFighter, BkfcRankingRow, BkfcArticle } from "./types";

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

function toFightStub(e: BkfcEvent, b: BkfcEvent["bouts"][number]): NormalizedFightStub {
  const winnerExternalId =
    b.winnerCorner === "red" ? (b.redSlug ?? undefined) : b.winnerCorner === "blue" ? (b.blueSlug ?? undefined) : undefined;
  return {
    redName: b.redName,
    blueName: b.blueName,
    redExternalId: b.redSlug ?? undefined,
    blueExternalId: b.blueSlug ?? undefined,
    weightClass: b.weightClass ?? undefined,
    scheduledRounds: b.scheduledRounds ?? BKFC_DEFAULT_ROUNDS,
    titleFight: b.titleFight,
    mainEvent: b.mainEvent,
    // result/method/winner are intentionally absent — not in BKFC static HTML.
    winnerExternalId,
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
