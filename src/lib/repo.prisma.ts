// ════════════════════════════════════════════════════════════════════════
//  PostgreSQL-backed repository (Prisma). Active when USE_MOCK_DATA=false.
//  Maps Prisma rows → the shared domain types in src/lib/types so the UI is
//  identical regardless of backend. repo.ts delegates here and falls back to
//  the mock layer if a query throws or the table is empty (e.g. pre-seed).
// ════════════════════════════════════════════════════════════════════════

import "server-only";
import { prisma } from "@/lib/db";
import { toCountryCode } from "@/lib/countries";
import { imageProxyUrl } from "@/lib/media-safe";
import type {
  Fighter, WeightClassRanking, Champion, RankedFighter,
  SanctioningBody, RankMovement, Stance, Fight, FightEvent,
  FightResult, FightMethod, EventStatus, FightPrediction,
} from "@/lib/types";
import type {
  Fighter as PFighter, Fight as PFight, Event as PEvent,
  WeightClass as PWeightClass, Prediction as PPrediction,
} from "@prisma/client";
// Forum repository (DB-backed, realtime) lives in its own module and is
// surfaced here so repo.prisma remains the single Prisma entry point.
export * from "@/lib/forum/repo";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : undefined);
const isoReq = (d: Date) => d.toISOString();

export function mapFighter(f: PFighter & { titles?: { body: string; weight: string; current: boolean }[] }): Fighter {
  return {
    id: f.id, slug: f.slug,
    name: f.name, nickname: f.nickname ?? undefined, sport: f.sport as Fighter["sport"],
    nationality: f.nationality ?? undefined, countryCode: f.countryCode ?? undefined,
    birthDate: iso(f.birthDate), birthPlace: f.birthPlace ?? undefined,
    residence: f.residence ?? undefined, heightCm: f.heightCm ?? undefined,
    reachCm: f.reachCm ?? undefined, stance: (f.stance as Stance) ?? undefined,
    debutDate: iso(f.debutDate), gym: f.gym ?? undefined, promoter: f.promoter ?? undefined,
    wins: f.wins, losses: f.losses, draws: f.draws, noContests: f.noContests,
    koWins: f.koWins, koLosses: f.koLosses, totalRounds: f.totalRounds,
    // Prefer our own stored image; else a free-licensed Commons photo shown via
    // the /api/img proxy (credit rendered on the profile from the fields below).
    ...(() => {
      const licensed = !f.imageUrl && f.photoLicense ? imageProxyUrl(f.photoUrl) : null;
      return {
        thumbUrl: f.thumbUrl ?? licensed ?? undefined,
        imageUrl: f.imageUrl ?? licensed ?? undefined,
        heroImageUrl: f.heroImageUrl ?? licensed ?? undefined,
      };
    })(),
    photoUrl: f.photoUrl ?? undefined,
    photoSource: f.photoSource ?? undefined,
    photoCredit: f.photoCredit ?? undefined,
    photoLicense: f.photoLicense ?? undefined,
    photoLicenseUrl: f.photoLicenseUrl ?? undefined,
    active: f.active, bio: f.bio ?? undefined,
    titles: f.titles?.map((t) => ({ body: t.body as SanctioningBody, weight: t.weight, current: t.current })),
  };
}

export async function listFighters(): Promise<Fighter[]> {
  const rows = await prisma.fighter.findMany({ orderBy: { wins: "desc" }, take: 1500, include: { titles: true } });
  return rows.map(mapFighter);
}

// Cursor-paginated, server-filtered directory query. Never loads everything.
export async function getFightersPage(opts: {
  sport?: string; country?: string; status?: string; q?: string;
  cursor?: string; limit?: number;
}): Promise<{ items: import("@/lib/types").FighterListItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 24, 1), 60);
  const where: import("@prisma/client").Prisma.FighterWhereInput = {};
  if (opts.sport) where.sport = opts.sport as PFighter["sport"];
  if (opts.country) where.countryCode = opts.country.toUpperCase();
  if (opts.status === "active") where.active = true;
  if (opts.status === "inactive") where.active = false;
  if (opts.q) {
    const q = opts.q.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { nickname: { contains: q, mode: "insensitive" } },
      { nationality: { contains: q, mode: "insensitive" } },
      { gym: { contains: q, mode: "insensitive" } },
      { residence: { contains: q, mode: "insensitive" } },
    ];
  }
  const rows = await prisma.fighter.findMany({
    where,
    // Claimed/self-signed-up profiles first so a fighter who just registered is
    // immediately visible (not buried behind ~1,500 scraped, photo'd fighters);
    // then photo-first for a rich cross-sport mix, then record. `id` is the final
    // tiebreaker that keeps cursor pagination stable.
    // Claimed first, then any displayable photo (own storage OR a licensed
    // Commons photo), then record. Ordering on both photo columns keeps
    // photo'd fighters — including licensed ones — at the top, not buried.
    orderBy: [
      { claimed: "desc" },
      { thumbUrl: { sort: "desc", nulls: "last" } },
      { photoUrl: { sort: "desc", nulls: "last" } },
      { wins: "desc" },
      { id: "asc" },
    ],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: {
      id: true, slug: true, name: true, nickname: true, sport: true,
      nationality: true, countryCode: true, residence: true,
      wins: true, losses: true, draws: true, noContests: true,
      active: true, thumbUrl: true, imageUrl: true, photoUrl: true, photoLicense: true,
      website: true, promoter: true, claimed: true,
    },
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    items: page.map((r) => {
      // A free-licensed Commons photo shown via the proxy when we have no own image.
      const licensed = !r.imageUrl && r.photoLicense ? imageProxyUrl(r.photoUrl) : null;
      return {
        slug: r.slug, name: r.name, nickname: r.nickname ?? undefined,
        sport: r.sport as import("@/lib/types").Sport,
        nationality: r.nationality ?? undefined, countryCode: r.countryCode ?? undefined,
        residence: r.residence ?? undefined,
        wins: r.wins, losses: r.losses, draws: r.draws, noContests: r.noContests,
        active: r.active,
        thumbUrl: r.thumbUrl ?? licensed ?? undefined,
        imageUrl: r.imageUrl ?? licensed ?? undefined,
        website: r.website ?? undefined, promoter: r.promoter ?? undefined, claimed: r.claimed,
      };
    }),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

// ── Fighter self-service profile (signup / onboarding) ───────────────────
export interface FighterProfileInput {
  name: string; sport: string; nickname?: string;
  nationality?: string; countryCode?: string; residence?: string; active: boolean;
  bio?: string; gym?: string; promotion?: string;
  website?: string; instagram?: string; twitter?: string;
  wins?: number; losses?: number; draws?: number; noContests?: number;
  beltRank?: string; style?: string; federation?: string; rank?: string;
}

const fighterSlugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "fighter";

const clampInt = (n: unknown) => Math.max(0, Math.min(9999, Math.floor(Number(n) || 0)));

/** The fighter profile owned by a user (their own claimed profile), or null. */
export async function getFighterByOwner(userId: string): Promise<{ slug: string; name: string; sport: string } | null> {
  const f = await prisma.fighter.findUnique({
    where: { ownerId: userId }, select: { slug: true, name: true, sport: true },
  });
  return f ? { slug: f.slug, name: f.name, sport: f.sport } : null;
}

/** Create or update the fighter profile owned by `userId`. */
export async function upsertFighterProfile(userId: string, input: FighterProfileInput): Promise<{ slug: string }> {
  const data = {
    name: input.name.trim(),
    sport: input.sport as PFighter["sport"],
    nickname: input.nickname?.trim() || null,
    nationality: input.nationality?.trim() || null,
    countryCode: input.countryCode?.trim().toUpperCase().slice(0, 2) || null,
    residence: input.residence?.trim() || null,
    active: input.active,
    bio: input.bio?.trim() || null,
    gym: input.gym?.trim() || null,
    promoter: input.promotion?.trim() || null,
    website: input.website?.trim() || null,
    instagram: input.instagram?.trim() || null,
    twitter: input.twitter?.trim() || null,
    wins: clampInt(input.wins), losses: clampInt(input.losses),
    draws: clampInt(input.draws), noContests: clampInt(input.noContests),
    beltRank: input.beltRank?.trim() || null,
    style: input.style?.trim() || null,
    federation: input.federation?.trim() || null,
    rank: input.rank?.trim() || null,
    claimed: true,
  };

  const existing = await prisma.fighter.findUnique({ where: { ownerId: userId }, select: { id: true, slug: true } });
  if (existing) {
    await prisma.fighter.update({ where: { id: existing.id }, data });
    return { slug: existing.slug };
  }
  const base = fighterSlugify(input.name);
  let slug = base;
  for (let i = 2; await prisma.fighter.findUnique({ where: { slug }, select: { id: true } }); i++) slug = `${base}-${i}`;
  await prisma.fighter.create({ data: { ...data, slug, ownerId: userId } });
  return { slug };
}

// Distinct countries present in the fighter table — for the directory filter.
export async function getFighterCountries(): Promise<{ code: string; name: string }[]> {
  const rows = await prisma.fighter.findMany({
    where: { countryCode: { not: null } },
    distinct: ["countryCode"],
    select: { countryCode: true, nationality: true },
    orderBy: { nationality: "asc" },
  });
  return rows
    .filter((r) => r.countryCode)
    .map((r) => ({ code: r.countryCode as string, name: r.nationality ?? (r.countryCode as string) }));
}

// ── Sport-aware discovery queries (rankings / p4p / predictions) ─────────

export interface RankingDivision {
  slug: string; name: string; limitLbs: number | null;
  rankings: RankedFighter[];
}

/** Divisional rankings for one sport. Empty array → no divisions for that sport. */
export async function getRankingDivisions(sportValue: string): Promise<RankingDivision[]> {
  const wcs = await prisma.weightClass.findMany({
    // Exclude pound-for-pound anchor weight classes (the `p4p-*` ones we create
    // for generated rankings, and the legacy boxing `pound-for-pound`).
    where: {
      sport: sportValue as PFighter["sport"],
      AND: [{ NOT: { slug: { startsWith: "p4p-" } } }, { slug: { not: "pound-for-pound" } }],
    },
    orderBy: { order: "asc" },
  });
  const out: RankingDivision[] = [];
  for (const wc of wcs) {
    const rows = await prisma.ranking.findMany({
      where: { weightClassId: wc.id, isPoundForPound: false },
      orderBy: { rank: "asc" },
      take: 9,
      include: { fighter: { include: { titles: true } } },
    });
    out.push({
      slug: wc.slug, name: wc.name, limitLbs: wc.limitLbs,
      rankings: rows.map((r) => ({
        rank: r.rank, previousRank: r.previousRank ?? undefined,
        movement: r.movement as RankMovement, rating: r.rating ?? undefined,
        fighter: mapFighter(r.fighter),
      })),
    });
  }
  return out;
}

/**
 * Pound-for-pound for a sport. Boxing has a curated Ranking table; other
 * sports derive a top list straight from the fighter database (real fighters
 * ordered by record), so every sport has a populated P4P. Paginated, 10/page.
 */
export async function getPoundForPoundBySport(
  sportValue: string | undefined, page: number, limit = 10,
): Promise<{ items: RankedFighter[]; total: number; source: "curated" | "generated" | "none" }> {
  const skip = Math.max(0, page) * limit;
  // No sportValue → "All Sports": the top rated across every combat sport.
  const where = {
    isPoundForPound: true,
    ...(sportValue ? { fighter: { sport: sportValue as PFighter["sport"] } } : {}),
  };

  const total = await prisma.ranking.count({ where });
  if (total === 0) return { items: [], total: 0, source: "none" };

  const rows = await prisma.ranking.findMany({
    where,
    // Within a sport, rank order is authoritative. Across all sports each sport
    // has its own rank 1..N, so order by rating to get a meaningful merged list.
    orderBy: sportValue ? { rank: "asc" } : [{ rating: { sort: "desc", nulls: "last" } }, { rank: "asc" }],
    skip, take: limit,
    include: { fighter: { include: { titles: true } } },
  });
  // If any row is from a scrape/official import it's curated; else generated.
  const anyCurated = await prisma.ranking.count({ where: { ...where, source: { not: "generated" } } });
  return {
    items: rows.map((r) => ({
      rank: r.rank, previousRank: r.previousRank ?? undefined,
      movement: r.movement as RankMovement, rating: r.rating ?? undefined,
      fighter: mapFighter(r.fighter),
    })),
    total,
    source: anyCurated > 0 ? "curated" : "generated",
  };
}

/** Upcoming predictions filtered by sport (via the red fighter's sport), paginated 10/page. */
export async function getPredictionsPage(
  sportValue: string | undefined, page: number, limit = 10,
): Promise<{ items: Fight[]; total: number }> {
  const skip = Math.max(0, page) * limit;
  const where = {
    result: "SCHEDULED" as const,
    ...(sportValue ? { red: { sport: sportValue as PFighter["sport"] } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.fight.findMany({ where, orderBy: { date: "asc" }, skip, take: limit, include: FIGHT_INCLUDE }),
    prisma.fight.count({ where }),
  ]);
  return { items: rows.map(mapFight), total };
}

export async function getFighter(slug: string): Promise<Fighter | null> {
  const f = await prisma.fighter.findUnique({ where: { slug }, include: { titles: true } });
  return f ? mapFighter(f) : null;
}

export async function searchFighters(query: string): Promise<Fighter[]> {
  const q = query.trim();
  if (!q) return [];
  const rows = await prisma.fighter.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { nickname: { contains: q, mode: "insensitive" } },
        { nationality: { contains: q, mode: "insensitive" } },
      ],
    },
    take: 8,
  });
  return rows.map(mapFighter);
}

async function buildRanking(weightClassSlug: string, p4p: boolean): Promise<WeightClassRanking | null> {
  const wc = p4p ? null : await prisma.weightClass.findUnique({ where: { slug: weightClassSlug } });
  const rows = await prisma.ranking.findMany({
    where: { isPoundForPound: p4p, ...(wc ? { weightClassId: wc.id } : {}) },
    orderBy: { rank: "asc" },
    include: { fighter: { include: { titles: true } } },
  });
  if (rows.length === 0) return null;
  const rankings: RankedFighter[] = rows.map((r) => ({
    rank: r.rank, previousRank: r.previousRank ?? undefined,
    movement: r.movement as RankMovement, rating: r.rating ?? undefined,
    fighter: mapFighter(r.fighter),
  }));
  return {
    weightClass: p4p ? "Pound for Pound" : wc?.name ?? weightClassSlug,
    slug: p4p ? "pound-for-pound" : weightClassSlug,
    isPoundForPound: p4p, rankings,
    updatedAt: (rows[0].updatedAt ?? new Date()).toISOString(),
  };
}

export async function getPoundForPound(): Promise<WeightClassRanking | null> {
  return buildRanking("pound-for-pound", true);
}

export async function getRankingBySlug(slug: string): Promise<WeightClassRanking | null> {
  return slug === "pound-for-pound" ? buildRanking(slug, true) : buildRanking(slug, false);
}

export async function getDivisionRankings(slugs: string[]): Promise<WeightClassRanking[]> {
  const all = await Promise.all(slugs.map((s) => buildRanking(s, false)));
  return all.filter((x): x is WeightClassRanking => x !== null);
}

export async function getOddsForFight(slug: string): Promise<import("@/lib/types").Odds[]> {
  const fight = await prisma.fight.findUnique({ where: { slug } });
  if (!fight) return [];
  const rows = await prisma.oddsSnapshot.findMany({
    where: { fightId: fight.id }, orderBy: { capturedAt: "desc" },
  });
  // Latest snapshot per bookmaker.
  const seen = new Set<string>();
  const out: import("@/lib/types").Odds[] = [];
  for (const r of rows) {
    if (seen.has(r.bookmaker)) continue;
    seen.add(r.bookmaker);
    out.push({
      bookmaker: r.bookmaker, redOdds: r.redOdds, blueOdds: r.blueOdds,
      redImplied: r.redImplied, blueImplied: r.blueImplied,
    });
  }
  return out;
}

export async function getChampions(): Promise<Champion[]> {
  return getChampionsBySport();
}

/** Current champions, optionally filtered to one sport (via the fighter). */
export async function getChampionsBySport(sportValue?: string): Promise<Champion[]> {
  const rows = await prisma.champion.findMany({
    where: { current: true, ...(sportValue ? { fighter: { sport: sportValue as PFighter["sport"] } } : {}) },
    include: { fighter: { include: { titles: true } }, weightClass: true },
  });
  return rows.map((c) => ({
    body: c.body as SanctioningBody,
    weightClass: c.weightClass.name, weightClassSlug: c.weightClass.slug,
    since: iso(c.since), defenses: c.defenses, fighter: mapFighter(c.fighter),
  }));
}

// ─── Events / Fights ──────────────────────────────────────────────────────

type PFighterWithTitles = PFighter & { titles?: { body: string; weight: string; current: boolean }[] };
type PFightFull = PFight & {
  red: PFighterWithTitles; blue: PFighterWithTitles;
  weightClass?: PWeightClass | null; predictions?: PPrediction[];
};

function mapPrediction(preds?: PPrediction[]): FightPrediction | undefined {
  if (!preds || preds.length === 0) return undefined;
  // Prefer the AI/model prediction, else the first available.
  const p = preds.find((x) => x.source === "AI") ?? preds[0];
  return {
    redProbability: p.redProbability, blueProbability: p.blueProbability,
    methodPrediction: (p.methodPrediction as FightMethod) ?? undefined,
    roundPrediction: p.roundPrediction ?? undefined,
    confidence: p.confidence ?? undefined,
    rationale: p.rationale ?? undefined,
  };
}

export function mapFight(f: PFightFull): Fight {
  return {
    id: f.id, slug: f.slug,
    red: mapFighter(f.red), blue: mapFighter(f.blue),
    weightClass: f.weightClass?.name ?? undefined,
    scheduledRounds: f.scheduledRounds,
    titleFight: f.titleFight, mainEvent: f.mainEvent, coMain: f.coMain,
    result: f.result as FightResult,
    winnerId: f.winnerId ?? undefined,
    method: (f.method as FightMethod) ?? undefined,
    roundEnded: f.roundEnded ?? undefined,
    timeEnded: f.timeEnded ?? undefined,
    date: isoReq(f.date),
    cardSegment: f.cardSegment ?? null,
    cancelled: f.cancelled,
    cardNote: f.cardNote ?? null,
    prediction: mapPrediction(f.predictions),
  };
}

const FIGHT_INCLUDE = {
  red: { include: { titles: true } },
  blue: { include: { titles: true } },
  weightClass: true,
  predictions: true,
} as const;

function mapEvent(e: PEvent & { fights: PFightFull[] }): FightEvent {
  return {
    id: e.id, slug: e.slug, name: e.name, sport: e.sport as Fighter["sport"],
    promotion: e.promotion ?? undefined, venue: e.venue ?? undefined,
    city: e.city ?? undefined, country: e.country ?? undefined,
    // Resolve to an ISO-2 code from whichever field carries it: older rows
    // stored a country *name* in countryCode, newer ones may only have country.
    countryCode: toCountryCode(e.countryCode) ?? toCountryCode(e.country) ?? undefined,
    broadcaster: e.broadcaster ?? undefined,
    posterUrl: e.posterUrl ?? undefined, date: isoReq(e.date),
    status: e.status as EventStatus,
    fights: e.fights.map(mapFight),
  };
}

export async function getUpcomingEvents(): Promise<FightEvent[]> {
  const rows = await prisma.event.findMany({
    where: { date: { gte: new Date() }, status: { notIn: ["COMPLETED", "CANCELLED"] } },
    orderBy: { date: "asc" },
    include: { fights: { include: FIGHT_INCLUDE, orderBy: { orderOnCard: "asc" } } },
  });
  return rows.map(mapEvent);
}

export async function getResults(): Promise<FightEvent[]> {
  const rows = await prisma.event.findMany({
    where: { OR: [{ date: { lt: new Date() } }, { status: "COMPLETED" }] },
    orderBy: { date: "desc" },
    take: 50,
    include: { fights: { include: FIGHT_INCLUDE, orderBy: { orderOnCard: "asc" } } },
  });
  return rows.map(mapEvent);
}

export async function getEvent(slug: string): Promise<FightEvent | null> {
  const e = await prisma.event.findUnique({
    where: { slug },
    include: { fights: { include: FIGHT_INCLUDE, orderBy: { orderOnCard: "asc" } } },
  });
  return e ? mapEvent(e) : null;
}

export async function getFight(slug: string): Promise<Fight | null> {
  const f = await prisma.fight.findUnique({ where: { slug }, include: FIGHT_INCLUDE });
  return f ? mapFight(f) : null;
}

export async function getFighterFights(slug: string): Promise<Fight[]> {
  const fighter = await prisma.fighter.findUnique({ where: { slug }, select: { id: true } });
  if (!fighter) return [];
  const rows = await prisma.fight.findMany({
    where: { OR: [{ redId: fighter.id }, { blueId: fighter.id }] },
    orderBy: { date: "desc" },
    include: FIGHT_INCLUDE,
  });
  return rows.map(mapFight);
}

export async function getFeaturedPredictions(): Promise<Fight[]> {
  const rows = await prisma.fight.findMany({
    where: { result: "SCHEDULED", date: { gte: new Date() } },
    orderBy: { date: "asc" },
    take: 24,
    include: FIGHT_INCLUDE,
  });
  return rows.map(mapFight);
}

// ─── News (live RSS aggregation → Article table) ──────────────────────────
type PArticle = import("@prisma/client").Article;
function mapArticle(a: PArticle): import("@/lib/types").Article {
  return {
    id: a.id, slug: a.slug, title: a.title,
    excerpt: a.excerpt ?? undefined, content: a.content ?? undefined,
    category: a.category, featured: a.featured,
    coverImageUrl: a.coverImageUrl ?? undefined,
    sourceUrl: a.sourceUrl ?? undefined,       // original article link (RSS)
    author: a.metaTitle ?? undefined,          // metaTitle holds the RSS source
    views: a.views,
    publishedAt: (a.publishedAt ?? a.createdAt).toISOString(),
  };
}

export async function getArticlesDb(): Promise<import("@/lib/types").Article[]> {
  const rows = await prisma.article.findMany({ where: { status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, take: 60 });
  return rows.map(mapArticle);
}

/**
 * Articles whose title matches ANY of `terms` (case-insensitive), newest first.
 * Used for event coverage so we search the whole news table, not just the recent
 * 60 — otherwise a promotion's stories never surface behind the MMA firehose.
 */
export async function getArticlesMatchingDb(
  terms: string[],
  limit: number,
): Promise<import("@/lib/types").Article[]> {
  if (!terms.length) return [];
  const rows = await prisma.article.findMany({
    where: {
      status: "PUBLISHED",
      OR: terms.map((t) => ({ title: { contains: t, mode: "insensitive" as const } })),
    },
    orderBy: { publishedAt: "desc" },
    take: limit,
  });
  return rows.map(mapArticle);
}
export async function getFeaturedArticleDb(): Promise<import("@/lib/types").Article | null> {
  const a = await prisma.article.findFirst({ where: { status: "PUBLISHED" }, orderBy: [{ featured: "desc" }, { publishedAt: "desc" }] });
  return a ? mapArticle(a) : null;
}
export async function getArticleDb(slug: string): Promise<import("@/lib/types").Article | null> {
  const a = await prisma.article.findUnique({ where: { slug } });
  return a && a.status === "PUBLISHED" ? mapArticle(a) : null;
}
