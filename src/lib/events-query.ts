import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SPORT_BY_SLUG } from "@/lib/sports";
import { PUBLIC_EVENT } from "@/lib/events-visibility";
import { resolvePromotion, promotionSearchTerms } from "@/lib/promotions";
import { safeFighterImageOrNull, imageProxyUrl } from "@/lib/media-safe";
import { decodeHtmlEntities } from "@/lib/text/entities";

// ════════════════════════════════════════════════════════════════════════════
//  Event discovery.
//
//  Filtering happens in POSTGRES. The previous implementation loaded every
//  upcoming event with every fight and every fighter, then sliced it in JS —
//  fine at 13 events, fatal at 1,300.
//
//  The card shape is deliberately lean: a card shows the headline bout, not the
//  whole undercard, so only the main event is joined. That is one row per event
//  instead of ~25.
// ════════════════════════════════════════════════════════════════════════════

export type EventStatusFilter = "upcoming" | "live" | "completed" | "cancelled";
export type DateWindow = "week" | "month" | "quarter";

export interface EventFilters {
  sport?: string;      // sport SLUG (mma, boxing…)
  promotion?: string;  // registry slug (ufc, one…)
  status?: string;     // EventStatusFilter
  country?: string;    // ISO country code
  when?: string;       // DateWindow
  page?: number;
}

export interface EventCard {
  id: string;
  slug: string;
  name: string;
  date: string;
  status: string;
  /** Prisma Sport enum value (e.g. "BOXING") — drives the sport tag + card art. */
  sport: string;
  promotion: string | null;
  promotionName: string;
  venue: string | null;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  broadcaster: string | null;
  posterUrl: string | null;
  heroUrl: string | null;
  eventUrl: string | null;
  ticketUrl: string | null;
  boutCount: number;
  mainEvent: {
    red: string;
    blue: string;
    titleFight: boolean;
    /** Media-safe fighter image URLs (or null) for the composed card background. */
    redImage: string | null;
    blueImage: string | null;
    /** Each corner's best current ranking, or null — event↔ranking intelligence. */
    redRank: FighterRank | null;
    blueRank: FighterRank | null;
  } | null;
  following: boolean;
}

/** A fighter's best current ranking, surfaced on the card. */
export interface FighterRank {
  rank: number;
  /** "p4p" (pound-for-pound) or "division" — how to read the number. */
  kind: "p4p" | "division";
  /** The ranking source (curated / ufc-mma / generated…) for provenance. */
  source: string;
}

export interface EventFacet { value: string; label: string; count: number }

export const PER_PAGE = 12;

const WINDOW_DAYS: Record<DateWindow, number> = { week: 7, month: 30, quarter: 90 };

/** Translate filters into a Prisma WHERE. Shared by the list and the facets so
 *  the counts can never disagree with the results. */
function buildWhere(f: EventFilters, opts?: { ignore?: keyof EventFilters }): Prisma.EventWhereInput {
  const now = new Date();
  // DRAFT never reaches discovery, search or the sitemap.
  const where: Prisma.EventWhereInput = { ...PUBLIC_EVENT };
  const use = (k: keyof EventFilters) => opts?.ignore !== k;

  const status = (f.status ?? "upcoming") as EventStatusFilter;
  if (use("status")) {
    if (status === "live") where.status = "LIVE";
    else if (status === "completed") { where.date = { lt: now }; where.status = { notIn: ["CANCELLED"] }; }
    else if (status === "cancelled") where.status = { in: ["CANCELLED", "POSTPONED"] };
    else { where.date = { gte: now }; where.status = { notIn: ["COMPLETED", "CANCELLED"] }; }
  }

  if (use("when") && f.when && WINDOW_DAYS[f.when as DateWindow]) {
    const days = WINDOW_DAYS[f.when as DateWindow];
    const to = new Date(now.getTime() + days * 86_400_000);
    // Compose with the status window rather than replacing it.
    where.date = status === "completed"
      ? { gte: new Date(now.getTime() - days * 86_400_000), lt: now }
      : { gte: now, lte: to };
  }

  if (use("sport") && f.sport) {
    const s = SPORT_BY_SLUG[f.sport];
    if (s) where.sport = s.value as Prisma.EventWhereInput["sport"];
  }

  // Promotion is stored as free text; a registry slug maps to the aliases that
  // identify it, so selecting "ufc" matches "UFC 300" and "UFC Fight Night".
  if (use("promotion") && f.promotion) {
    where.OR = promotionSearchTerms([f.promotion]).map((t) => ({ promotion: { contains: t, mode: "insensitive" as const } }));
  }

  if (use("country") && f.country) where.countryCode = f.country.toUpperCase();

  return where;
}

const FIGHTER_CARD_SELECT = {
  name: true, imageUrl: true, thumbUrl: true, countryCode: true,
  // Enriched Wikimedia photos live in photoUrl (raw URL) and display through the
  // /api/img proxy — the same resolution repo.prisma uses. Without these the card
  // missed every enriched fighter's photo and fell back to a gradient.
  photoUrl: true, photoLicense: true,
  // Best current ranking (lowest rank number wins) — powers the "#2" badge and
  // the ranked-matchup line. Division ranks read plainly; P4P ranks are labelled.
  rankings: { orderBy: { rank: "asc" as const }, take: 1, select: { rank: true, source: true, isPoundForPound: true } },
} as const;

/** Map a fighter's top ranking row to the card's FighterRank, or null. */
function cardFighterRank(f: { rankings: { rank: number; source: string; isPoundForPound: boolean }[] }): FighterRank | null {
  const r = f.rankings[0];
  if (!r) return null;
  return { rank: r.rank, kind: r.isPoundForPound ? "p4p" : "division", source: r.source };
}

/** Card fighter image: own storage → proxied licensed Wikimedia photo → null. */
function cardFighterImage(f: {
  imageUrl: string | null; thumbUrl: string | null; photoUrl: string | null; photoLicense: string | null;
}): string | null {
  return (
    safeFighterImageOrNull(f.imageUrl ?? f.thumbUrl) ??
    (!f.imageUrl && f.photoLicense ? imageProxyUrl(f.photoUrl) : null)
  );
}

const CARD_SELECT = {
  id: true, slug: true, name: true, date: true, status: true, sport: true, promotion: true,
  venue: true, city: true, country: true, countryCode: true, broadcaster: true,
  // Both artwork shapes + the action URLs a card surfaces (watch / tickets).
  posterUrl: true, heroUrl: true, eventUrl: true, ticketUrl: true,
  _count: { select: { fights: true } },
  // The headline bout only — a card shows the marquee, not the undercard. Fighter
  // photos are pulled so the card can compose a "fighter vs fighter" background
  // when the promotion supplied no event artwork (see lib/event-artwork).
  fights: {
    where: { mainEvent: true },
    take: 1,
    select: {
      titleFight: true,
      red: { select: FIGHTER_CARD_SELECT },
      blue: { select: FIGHTER_CARD_SELECT },
    },
  },
} as const;

/**
 * One page of events plus the total, filtered in the database.
 *
 * `followedIds` is passed in (already batched by the caller) rather than joined
 * per row, so the viewer's follow state costs one query for the whole page.
 */
export async function queryEvents(
  f: EventFilters,
  followedIds: Set<string> = new Set(),
): Promise<{ events: EventCard[]; total: number; page: number; pages: number }> {
  const where = buildWhere(f);
  const page = Math.max(0, f.page ?? 0);
  const desc = (f.status ?? "upcoming") === "completed";

  const [rows, total] = await Promise.all([
    prisma.event.findMany({
      where,
      orderBy: { date: desc ? "desc" : "asc" },
      skip: page * PER_PAGE,
      take: PER_PAGE,
      select: CARD_SELECT,
    }),
    prisma.event.count({ where }),
  ]);

  return {
    events: rows.map((e) => {
      const m = e.fights[0];
      return {
        id: e.id, slug: e.slug, name: decodeHtmlEntities(e.name), date: e.date.toISOString(), status: e.status,
        sport: e.sport,
        promotion: e.promotion, promotionName: resolvePromotion(e.promotion).name,
        venue: e.venue, city: e.city, country: e.country, countryCode: e.countryCode,
        broadcaster: e.broadcaster,
        posterUrl: e.posterUrl, heroUrl: e.heroUrl, eventUrl: e.eventUrl, ticketUrl: e.ticketUrl,
        boutCount: e._count.fights,
        mainEvent: m
          ? {
              red: decodeHtmlEntities(m.red.name), blue: decodeHtmlEntities(m.blue.name), titleFight: m.titleFight,
              redImage: cardFighterImage(m.red),
              blueImage: cardFighterImage(m.blue),
              redRank: cardFighterRank(m.red),
              blueRank: cardFighterRank(m.blue),
            }
          : null,
        following: followedIds.has(e.id),
      };
    }),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PER_PAGE)),
  };
}

/**
 * Options for the promotion and country pickers.
 *
 * Each facet ignores its OWN filter, so choosing "UFC" doesn't collapse the
 * promotion list to just UFC — you can still switch. Two grouped counts, not a
 * scan of the table.
 */
export async function getEventFacets(f: EventFilters): Promise<{ promotions: EventFacet[]; countries: EventFacet[] }> {
  const [byPromotion, byCountry] = await Promise.all([
    prisma.event.groupBy({
      by: ["promotion"],
      where: { ...buildWhere(f, { ignore: "promotion" }), promotion: { not: null } },
      _count: { promotion: true },
    }),
    prisma.event.groupBy({
      by: ["countryCode", "country"],
      where: { ...buildWhere(f, { ignore: "country" }), countryCode: { not: null } },
      _count: { countryCode: true },
    }),
  ]);

  // Collapse free-text promotion names onto registry slugs so "UFC 300" and
  // "UFC Fight Night" are one option, not two.
  const promoCounts = new Map<string, { label: string; count: number }>();
  for (const row of byPromotion) {
    const p = resolvePromotion(row.promotion);
    if (p.slug === "combat") continue;
    const cur = promoCounts.get(p.slug);
    if (cur) cur.count += row._count.promotion;
    else promoCounts.set(p.slug, { label: p.name, count: row._count.promotion });
  }

  const countryCounts = new Map<string, { label: string; count: number }>();
  for (const row of byCountry) {
    if (!row.countryCode) continue;
    const cur = countryCounts.get(row.countryCode);
    if (cur) cur.count += row._count.countryCode;
    else countryCounts.set(row.countryCode, { label: row.country ?? row.countryCode, count: row._count.countryCode });
  }

  const sort = (m: Map<string, { label: string; count: number }>): EventFacet[] =>
    [...m.entries()].map(([value, v]) => ({ value, label: v.label, count: v.count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return { promotions: sort(promoCounts).slice(0, 14), countries: sort(countryCounts).slice(0, 14) };
}
