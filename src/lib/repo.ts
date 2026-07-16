// ════════════════════════════════════════════════════════════════════════
//  Data repository — the ONLY surface the UI talks to (repository pattern).
//
//  LIVE ONLY: every read hits PostgreSQL via Prisma (src/lib/repo.prisma.ts),
//  populated by the ingestion cron jobs. There is no mock/fixture fallback —
//  if a table is empty the screen renders its empty state; on a hard DB error
//  (after one cold-start retry) an empty value is returned. Reads are cached.
// ════════════════════════════════════════════════════════════════════════

import "server-only";
import type {
  Fighter, WeightClassRanking, Champion, FightEvent, Fight, Article, FighterListItem,
} from "@/lib/types";
import type { RankingDivision } from "@/lib/repo.prisma";
import { cached, CACHE_TTL } from "@/lib/cache";
import { maybeRefreshNews } from "@/lib/news/lazy-refresh";
// Weight-class taxonomy (reference config — the divisions themselves, not mock
// fight data). Everything else comes live from Postgres.
import { WEIGHT_CLASSES } from "@/lib/data/rankings";
import * as pg from "@/lib/repo.prisma";

export const WEIGHT_CLASS_LIST = WEIGHT_CLASSES;

/**
 * Run a live Prisma read. Returns the live result as-is (including empty). On a
 * hard error — after one retry that absorbs Prisma cold-start blips — returns
 * the provided empty value. No mock/fixture fallback.
 */
async function live<T>(fn: () => Promise<T>, empty: T): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === 0) { await new Promise((r) => setTimeout(r, 150)); continue; }
      console.warn(`[repo] live read failed: ${(e as Error).message}`);
      return empty;
    }
  }
  return empty;
}

// ─── Fighters ───────────────────────────────────────────────────────────
export async function getFighter(slug: string): Promise<Fighter | null> {
  return live(() => pg.getFighter(slug), null);
}

export async function listFighters(): Promise<Fighter[]> {
  return live(() => pg.listFighters(), []);
}

export async function searchFighters(query: string): Promise<Fighter[]> {
  if (!query.trim()) return [];
  return live(() => pg.searchFighters(query), []);
}

export async function getFighterFights(slug: string): Promise<Fight[]> {
  return live(() => pg.getFighterFights(slug), []);
}

// ─── Rankings ───────────────────────────────────────────────────────────
const EMPTY_PFP: WeightClassRanking = { weightClass: "Pound for Pound", slug: "pound-for-pound", isPoundForPound: true, rankings: [], updatedAt: "" };

export async function getPoundForPound(): Promise<WeightClassRanking> {
  return cached("rankings:pound-for-pound", CACHE_TTL.RANKINGS, () =>
    live<WeightClassRanking>(async () => (await pg.getPoundForPound()) ?? EMPTY_PFP, EMPTY_PFP));
}

export async function getDivisionRankings(): Promise<WeightClassRanking[]> {
  return live(() => pg.getDivisionRankings(WEIGHT_CLASSES.map((w) => w.slug)), []);
}

export async function getRankingBySlug(slug: string): Promise<WeightClassRanking | null> {
  return cached(`rankings:${slug}`, CACHE_TTL.RANKINGS, () => live(() => pg.getRankingBySlug(slug), null));
}

// ─── Champions ──────────────────────────────────────────────────────────
export async function getChampions(): Promise<Champion[]> {
  return cached("champions", CACHE_TTL.RANKINGS, () => live(() => pg.getChampions(), []));
}

// ─── Events / Schedule / Results ────────────────────────────────────────
export async function getUpcomingEvents(): Promise<FightEvent[]> {
  return cached("events:upcoming", CACHE_TTL.EVENTS, () => live(() => pg.getUpcomingEvents(), []));
}

export async function getResults(): Promise<FightEvent[]> {
  return cached("events:results", CACHE_TTL.EVENTS, () => live(() => pg.getResults(), []));
}

export async function getEvent(slug: string): Promise<FightEvent | null> {
  return live(() => pg.getEvent(slug), null);
}

// ─── Predictions ────────────────────────────────────────────────────────
export async function getFeaturedPredictions(): Promise<Fight[]> {
  return live(() => pg.getFeaturedPredictions(), []);
}

export async function getFight(slug: string): Promise<Fight | null> {
  return live(() => pg.getFight(slug), null);
}

/**
 * Real bookmaker odds for a fight, from OddsSnapshot (licensed odds feed).
 * Returns [] when no live market is connected — the UI shows an honest
 * "awaiting live lines" state rather than fabricating numbers.
 */
export async function getOddsForFight(slug: string): Promise<import("@/lib/types").Odds[]> {
  return cached(`odds:${slug}`, 300, () => live(() => pg.getOddsForFight(slug), []));
}

// ─── News ───────────────────────────────────────────────────────────────
export async function getArticles(): Promise<Article[]> {
  const articles = await cached("articles:all", CACHE_TTL.EVENTS, () => live(() => pg.getArticlesDb(), []));
  // Self-heal if the freshest article is stale (see lazy-refresh). Non-blocking:
  // this request still returns the cached list; the next visitor sees fresh news.
  const newest = articles.reduce<number>((m, a) => Math.max(m, +new Date(a.publishedAt)), 0);
  maybeRefreshNews(newest ? new Date(newest) : null);
  return articles;
}

export async function getFeaturedArticle(): Promise<Article | undefined> {
  return live(async () => (await pg.getFeaturedArticleDb()) ?? undefined, undefined);
}

/** Event coverage: articles whose title matches any of `terms`, newest first. */
export async function getEventCoverage(terms: string[], limit = 12): Promise<Article[]> {
  if (!terms.length) return [];
  const key = `coverage:${terms.slice().sort().join("|")}:${limit}`;
  return cached(key, CACHE_TTL.EVENTS, () => live(() => pg.getArticlesMatchingDb(terms, limit), []));
}

export async function getArticle(slug: string): Promise<Article | null> {
  return live(() => pg.getArticleDb(slug), null);
}

// ─── Registry screens (sport-aware, paginated) — live only ───────────────
//  Rankings, P4P and the Fighters directory read through here so the data
//  surface stays consistent. `usedFallback` is retained in the return shape
//  (always false now) so existing callers keep compiling.

type WithFallback<T> = { data: T; usedFallback: boolean };
type FightersPageOpts = { sport?: string; country?: string; status?: string; q?: string; cursor?: string; limit?: number };

export async function getRankingDivisionsSafe(sportValue: string): Promise<WithFallback<RankingDivision[]>> {
  return { data: await live(() => pg.getRankingDivisions(sportValue), []), usedFallback: false };
}

export async function getPoundForPoundPage(sportValue: string | undefined, page: number, limit = 10) {
  const data = await live(
    () => pg.getPoundForPoundBySport(sportValue, page, limit),
    { items: [] as RankedFighterLite[], total: 0, source: "none" as const },
  );
  return { ...data, usedFallback: false };
}

export async function getFightersPageSafe(opts: FightersPageOpts) {
  const data = await live(
    () => pg.getFightersPage(opts),
    { items: [] as FighterListItem[], nextCursor: null as string | null },
  );
  return { ...data, usedFallback: false };
}

export async function getFighterCountriesSafe(): Promise<{ code: string; name: string }[]> {
  return live(() => pg.getFighterCountries(), []);
}

// Row shape returned by the P4P page query (kept local to avoid re-importing).
type RankedFighterLite = Awaited<ReturnType<typeof pg.getPoundForPoundBySport>>["items"][number];

// ─── Forum ──────────────────────────────────────────────────────────────
// Forum data is fully DB-backed + realtime; see src/lib/forum/repo.ts.
