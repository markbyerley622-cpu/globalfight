/**
 * Read accessors over the fixture layer. This is the ONLY surface the UI uses
 * to fetch domain data. Each function mirrors a query a real API/DB would
 * expose, so replacing fixtures with live data means reimplementing this file
 * (ideally async) without touching components.
 *
 * Relationships are resolved by stable ID — never by text matching.
 */
import type {
  Article,
  Athlete,
  DiscussionPost,
  DiscussionPrompt,
  Event,
  Fight,
  FightResult,
  PredictionMarket,
  Promotion,
  Sport,
  SportSlug,
  Venue,
} from "@/lib/domain/types";
import {
  ARTICLES,
  ATHLETES,
  EVENTS,
  FIGHTS,
  MARKETS,
  PROMOTIONS,
  PROMPTS,
  POSTS,
  RESULTS,
  SPORTS,
  VENUES,
  athlete as athleteById,
} from "./fixtures";

// --- Sports -----------------------------------------------------------------

export function getSports(): Sport[] {
  return SPORTS;
}

export function getSportBySlug(slug: string): Sport | undefined {
  return SPORTS.find((s) => s.slug === slug);
}

export function getSportById(id: string): Sport | undefined {
  return SPORTS.find((s) => s.id === id);
}

// --- Promotions / venues ----------------------------------------------------

export function getPromotion(id: string): Promotion | undefined {
  return PROMOTIONS.find((p) => p.id === id);
}

export function getVenue(id: string): Venue | undefined {
  return VENUES.find((v) => v.id === id);
}

// --- Athletes ---------------------------------------------------------------

export function getAthlete(id: string): Athlete {
  return athleteById(id);
}

export function listAthletes(): Athlete[] {
  return ATHLETES;
}

// --- Events -----------------------------------------------------------------

export function getEventsBySport(sportSlug: string): Event[] {
  const sport = getSportBySlug(sportSlug);
  if (!sport) return [];
  return EVENTS.filter((e) => e.sportId === sport.id);
}

/** How many events each sport currently has — powers switcher badges. */
export function eventCountsBySport(): Record<SportSlug, number> {
  const counts = {} as Record<SportSlug, number>;
  for (const sport of SPORTS) {
    counts[sport.slug] = EVENTS.filter((e) => e.sportId === sport.id).length;
  }
  return counts;
}

export function getEvent(sportSlug: string, eventSlug: string): Event | undefined {
  const sport = getSportBySlug(sportSlug);
  if (!sport) return undefined;
  return EVENTS.find((e) => e.sportId === sport.id && e.slug === eventSlug);
}

// --- Fights -----------------------------------------------------------------

export function getFightsForEvent(eventId: string): Fight[] {
  return FIGHTS.filter((f) => f.eventId === eventId);
}

export function getFight(eventId: string, fightSlug: string): Fight | undefined {
  return FIGHTS.find((f) => f.eventId === eventId && f.slug === fightSlug);
}

export function getFightById(fightId: string): Fight | undefined {
  return FIGHTS.find((f) => f.id === fightId);
}

export function getResult(fightId: string): FightResult | undefined {
  return RESULTS.find((r) => r.fightId === fightId);
}

// --- Coverage ---------------------------------------------------------------

export function getArticlesForEvent(eventId: string): Article[] {
  return ARTICLES.filter((a) => a.eventId === eventId).sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
}

// --- Predictions ------------------------------------------------------------

export function getMarketForFight(fightId: string): PredictionMarket | undefined {
  return MARKETS.find((m) => m.fightId === fightId);
}

export function getMarketsForEvent(eventId: string): PredictionMarket[] {
  return MARKETS.filter((m) => m.eventId === eventId);
}

// --- Discussion -------------------------------------------------------------

export function getPostsForEvent(eventId: string): DiscussionPost[] {
  return POSTS.filter((p) => p.eventId === eventId);
}

export function getPromptsForEvent(eventId: string): DiscussionPrompt[] {
  return PROMPTS.filter((p) => p.eventId === eventId);
}
