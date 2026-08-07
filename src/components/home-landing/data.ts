import "server-only";

import { queryEvents } from "@/lib/events-query";
import { getCrowdForFightIds } from "@/lib/picks";
import { getResults, getArticles } from "@/lib/repo";
import { getLeaderboard } from "@/lib/reputation";
import { prisma } from "@/lib/db";
import { promotionLabel } from "@/lib/promotions";
import { SPORT_LABEL } from "@/lib/sports";
import { publicDisplayName } from "@/lib/display-name";
import { pickHero, crowdSplit, FALLBACK_HERO } from "./hero-fallback";

/**
 * Everything the landing page shows, loaded once on the server.
 *
 * ── Three rules this module exists to enforce ────────────────────────────────
 *
 * 1. **No new public API.** Every field below comes from a loader the product
 *    already uses to render a real page — `queryEvents` powers /events,
 *    `getCrowdForFightIds` powers the Quick Pick on every event card,
 *    `getLeaderboard` powers /leaderboard. A marketing page that invented its
 *    own read path would drift from the product it advertises within a sprint.
 *
 * 2. **Nothing private leaves here.** The only person-shaped data is the
 *    predictor leaderboard, which is already a public board, and it is passed
 *    through `publicDisplayName` — the same function /leaderboard uses — so a
 *    member who has not published a name is rendered as their handle, never
 *    their real one. No email, no id, no follower, no pick belonging to an
 *    identifiable member, and nothing from a private discussion.
 *
 * 3. **Every section survives an empty database.** Each loader is wrapped so a
 *    failure or an empty result degrades to a `null`/`[]` the component knows
 *    how to render — see FALLBACK_HERO for the one case where a blank space
 *    would leave the page looking broken rather than quiet. A landing page is
 *    the first thing a crawler and a new visitor see; it does not get to 500.
 */

/* ── Shapes ─────────────────────────────────────────────────────────────────── */

export interface HeroCorner {
  name: string;
  slug: string | null;
  record: string;
  /** Best current ranking, when the registry has one. Never invented. */
  rank: number | null;
}

export interface HeroEvent {
  slug: string | null;
  name: string;
  promotion: string;
  sport: string;
  date: string;
  venue: string | null;
  location: string | null;
  broadcaster: string | null;
  boutCount: number;
  titleFight: boolean;
  red: HeroCorner;
  blue: HeroCorner;
  /** Whole-percent split of the crowd's calls, or null when nobody has picked. */
  crowd: { red: number; blue: number; total: number } | null;
  /** True when this is the deterministic stand-in, not a row from the database. */
  placeholder: boolean;
}

export interface MiniEvent {
  slug: string | null;
  name: string;
  promotion: string;
  sport: string;
  date: string;
  location: string | null;
}

export interface FighterPreview {
  slug: string | null;
  name: string;
  nickname: string | null;
  sport: string;
  country: string | null;
  countryCode: string | null;
  record: string;
  nextFight: { opponent: string; event: string; date: string } | null;
  recent: { opponent: string; outcome: string; date: string }[];
}

export interface ResultPreview {
  event: string;
  slug: string | null;
  date: string;
  winner: string;
  loser: string;
  outcome: string;
}

export interface LocationPreview {
  events: { name: string; city: string; country: string; countryCode: string | null }[];
  gyms: { name: string; city: string; country: string }[];
  countries: number;
}

export interface CoveragePreview {
  slug: string | null;
  title: string;
  category: string;
  publishedAt: string | null;
}

export interface LeaderPreview {
  name: string;
  points: number;
  accuracy: number;
}

export interface LandingData {
  hero: HeroEvent;
  upNext: MiniEvent[];
  fighter: FighterPreview | null;
  result: ResultPreview | null;
  location: LocationPreview;
  coverage: CoveragePreview[];
  leaders: LeaderPreview[];
}

/** Never let one loader's outage take the page down. */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

const place = (city: string | null, country: string | null) =>
  [city, country].filter(Boolean).join(", ") || null;

const sportLabel = (v: string) => SPORT_LABEL[v] ?? v;

/* ── The hero event ─────────────────────────────────────────────────────────
   The selection rule and the stand-in both live in ./hero-fallback, as pure
   functions this module has no way to diverge from and the unit suite can run
   without a database. */

async function loadEvents(): Promise<{ hero: HeroEvent; upNext: MiniEvent[] }> {
  const { events } = await queryEvents({ status: "upcoming", page: 0 });
  const chosen = pickHero(events);
  if (!chosen) return { hero: FALLBACK_HERO, upNext: [] };

  const main = chosen.mainEvent;
  // One batched read, exactly as the events page does it — not one query per card.
  const crowdMap = main ? await safe(() => getCrowdForFightIds([main.fightId]), new Map()) : new Map();
  const crowd = main ? crowdMap.get(main.fightId) ?? null : null;

  const hero: HeroEvent = {
    slug: chosen.slug,
    name: chosen.name,
    promotion: chosen.promotionName || promotionLabel(chosen.promotion),
    sport: sportLabel(chosen.sport),
    date: chosen.date,
    venue: chosen.venue,
    location: place(chosen.city, chosen.country),
    broadcaster: chosen.broadcaster,
    boutCount: chosen.boutCount,
    titleFight: Boolean(main?.titleFight),
    red: {
      name: main?.red ?? "Red corner",
      slug: main?.redSlug ?? null,
      record: main?.redRecord ?? "",
      rank: main?.redRank?.rank ?? null,
    },
    blue: {
      name: main?.blue ?? "Blue corner",
      slug: main?.blueSlug ?? null,
      record: main?.blueRecord ?? "",
      rank: main?.blueRank?.rank ?? null,
    },
    // A split is only meaningful once somebody has actually called it. Zero picks
    // renders as "no calls yet", not as a 50/50 nobody made.
    crowd: crowdSplit(crowd),
    placeholder: false,
  };

  const upNext: MiniEvent[] = events
    .filter((e) => e.id !== chosen.id)
    .slice(0, 3)
    .map((e) => ({
      slug: e.slug,
      name: e.name,
      promotion: e.promotionName || promotionLabel(e.promotion),
      sport: sportLabel(e.sport),
      date: e.date,
      location: place(e.city, e.country),
    }));

  return { hero, upNext };
}

/* ── Fighter window ─────────────────────────────────────────────────────────
   The headline fighter from the hero card, so the two panels tell one story
   rather than introducing a second unrelated athlete. */

async function loadFighter(slug: string | null): Promise<FighterPreview | null> {
  if (!slug) return null;
  const f = await prisma.fighter.findUnique({
    where: { slug },
    select: {
      slug: true, name: true, nickname: true, sport: true, primarySport: true,
      nationality: true, countryCode: true, wins: true, losses: true, draws: true,
    },
  });
  if (!f) return null;

  const bouts = await prisma.fight.findMany({
    where: { OR: [{ red: { slug } }, { blue: { slug } }] },
    orderBy: { date: "desc" },
    take: 6,
    select: {
      date: true, result: true, winnerId: true, method: true, roundEnded: true,
      red: { select: { id: true, name: true } },
      blue: { select: { id: true, name: true } },
      event: { select: { name: true } },
    },
  });

  const self = (b: (typeof bouts)[number]) => (b.red.name === f.name ? b.red : b.blue);
  const other = (b: (typeof bouts)[number]) => (b.red.name === f.name ? b.blue : b.red);

  const upcoming = bouts.filter((b) => b.result === "SCHEDULED").at(-1) ?? null;
  const settled = bouts.filter((b) => b.result !== "SCHEDULED").slice(0, 3);

  return {
    slug: f.slug,
    name: f.name,
    nickname: f.nickname,
    sport: sportLabel(f.primarySport ?? f.sport),
    country: f.nationality,
    countryCode: f.countryCode,
    record: `${f.wins}-${f.losses}${f.draws ? `-${f.draws}` : ""}`,
    nextFight: upcoming
      ? { opponent: other(upcoming).name, event: upcoming.event?.name ?? "TBA", date: upcoming.date.toISOString() }
      : null,
    recent: settled.map((b) => ({
      opponent: other(b).name,
      outcome:
        b.winnerId === null
          ? "Draw"
          : `${b.winnerId === self(b).id ? "Win" : "Loss"}${b.method ? ` · ${b.method}` : ""}${b.roundEnded ? ` R${b.roundEnded}` : ""}`,
      date: b.date.toISOString(),
    })),
  };
}

/* ── Results window ─────────────────────────────────────────────────────────── */

async function loadResult(): Promise<ResultPreview | null> {
  const { events } = await getResults(1);
  for (const e of events) {
    const decided = e.fights.find((f) => f.winnerId);
    if (!decided) continue;
    const winner = decided.winnerId === decided.red.id ? decided.red : decided.blue;
    const loser = decided.winnerId === decided.red.id ? decided.blue : decided.red;
    return {
      event: e.name,
      slug: e.slug,
      date: typeof e.date === "string" ? e.date : new Date(e.date).toISOString(),
      winner: winner.name,
      loser: loser.name,
      // Formatted exactly as /results formats it, so the preview and the real
      // results page cannot describe the same bout in two different ways.
      outcome: `${decided.method ?? "Win"}${decided.roundEnded ? ` R${decided.roundEnded}` : ""}`,
    };
  }
  return null;
}

/* ── Location window ─────────────────────────────────────────────────────────
   Counts and place names only. No coordinates, no map tiles and no clustering —
   /map is the map; this is a picture of one. */

async function loadLocation(): Promise<LocationPreview> {
  const [events, gyms, countries] = await Promise.all([
    prisma.event.findMany({
      where: { date: { gte: new Date() }, city: { not: null } },
      orderBy: { date: "asc" },
      take: 4,
      select: { name: true, city: true, country: true, countryCode: true },
    }),
    prisma.gym.findMany({
      where: { city: { not: null } },
      orderBy: { name: "asc" },
      take: 3,
      select: { name: true, city: true, country: true },
    }),
    prisma.event
      .findMany({
        where: { date: { gte: new Date() }, countryCode: { not: null } },
        distinct: ["countryCode"],
        select: { countryCode: true },
      })
      .then((rows) => rows.length),
  ]);

  return {
    events: events.map((e) => ({
      name: e.name, city: e.city ?? "", country: e.country ?? "", countryCode: e.countryCode,
    })),
    gyms: gyms.map((g) => ({ name: g.name, city: g.city ?? "", country: g.country ?? "" })),
    countries,
  };
}

/* ── Coverage window ────────────────────────────────────────────────────────── */

async function loadCoverage(): Promise<CoveragePreview[]> {
  const articles = await getArticles();
  return articles.slice(0, 3).map((a) => ({
    slug: a.slug,
    title: a.title,
    category: a.category,
    publishedAt: a.publishedAt ? new Date(a.publishedAt).toISOString() : null,
  }));
}

/* ── Predictor board ────────────────────────────────────────────────────────
   Already a public board at /leaderboard. `publicDisplayName` is the same guard
   that page applies, so a member who has not published a name appears as their
   handle here too — the landing page must not be the one surface that leaks it. */

async function loadLeaders(): Promise<LeaderPreview[]> {
  const rows = await getLeaderboard("all", 3);
  return rows
    .filter((l) => l.picksResolved > 0)
    .map((l) => ({
      name: publicDisplayName({ name: l.name, username: l.username }),
      points: l.points,
      accuracy: l.accuracy,
    }));
}

/* ── Entry point ────────────────────────────────────────────────────────────── */

export async function getLandingData(): Promise<LandingData> {
  const { hero, upNext } = await safe(loadEvents, { hero: FALLBACK_HERO, upNext: [] as MiniEvent[] });

  const [fighter, result, location, coverage, leaders] = await Promise.all([
    safe(() => loadFighter(hero.red.slug), null),
    safe(loadResult, null),
    safe(loadLocation, { events: [], gyms: [], countries: 0 }),
    safe(loadCoverage, [] as CoveragePreview[]),
    safe(loadLeaders, [] as LeaderPreview[]),
  ]);

  return { hero, upNext, fighter, result, location, coverage, leaders };
}
