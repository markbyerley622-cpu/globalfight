import "server-only";
import { cache } from "react";
import type { Article, Fight, FightEvent } from "@/lib/types";
import { getEventCoverage } from "@/lib/repo";
import { rankCoverage } from "@/lib/event-format";
import { recommendVideos, type VideoRec } from "@/lib/feed/recommend";
import { resolvePromotion } from "@/lib/promotions";
import {
  coverageTerms,
  officialResultFrom,
  selectHeroVideo,
  enrichmentConfidence,
  type EventPhase,
  type OfficialResult,
} from "@/lib/events/enrichment-derive";

// ════════════════════════════════════════════════════════════════════════════
//  Event Enrichment engine — ONE computation, every surface.
//
//  Coverage ranking, source authority, freshness, deduplication and video
//  matching were each built as separate helpers. The mistake would be to let
//  every page (event, fighter, promotion, search, home, feed) re-wire them, so
//  the taxonomy drifts six ways. Instead they compose HERE, once, into a single
//  enriched object. A surface asks getEventEnrichment(event, fights) and renders
//  the parts it wants — it never re-derives the intelligence.
//
//  Everything returned is evidence-backed: the result is the stored winner, the
//  hero is a real highlight whose title says so, the coverage names a fighter on
//  the card. Nothing here is generated or inferred.
// ════════════════════════════════════════════════════════════════════════════

export type { OfficialResult, EventPhase } from "@/lib/events/enrichment-derive";

export interface EventEnrichment {
  /** "post" once the card has happened, else "pre" — drives ordering everywhere. */
  phase: EventPhase;
  /** Ranked, deduped, relevance-filtered coverage (main-event stories weigh most). */
  coverage: Article[];
  /** The single lead story, or null. */
  featuredCoverage: Article | null;
  /** Phase-ordered videos for this card (highlights lead post-fight). */
  videos: VideoRec[];
  /** The one clip to feature — the top highlight on a completed card, else null. */
  heroVideo: VideoRec | null;
  /** The verified main-event outcome (post only, null when none is recorded). */
  officialResult: OfficialResult | null;
  coverageCount: number;
  videoCount: number;
  /** 0–100 completeness of this enrichment (see enrichmentConfidence). */
  confidence: number;
  /** ISO timestamp this object was computed — for "enriched X ago" affordances. */
  lastEnrichedAt: string;
}

/**
 * Build the enriched view of an event. The heavy read (the coverage pool) is
 * already cached() inside getEventCoverage; the video read is viewer-aware (mute
 * lists) so it stays live rather than shared across viewers. React `cache`
 * dedupes the whole call within a single request so the page and any sibling
 * (metadata, hero) share one computation.
 */
export const getEventEnrichment = cache(_getEventEnrichment);

async function _getEventEnrichment(
  event: FightEvent,
  fights: Fight[],
  opts: { viewerId?: string | null } = {},
): Promise<EventEnrichment> {
  const eventDate = new Date(event.date);
  const now = Date.now();
  const phase: EventPhase = eventDate.getTime() < now ? "post" : "pre";
  const headline = fights.find((f) => f.mainEvent) ?? fights[0];

  // Two independent reads run concurrently; the coverage pool is cached, the
  // video read is per-viewer. Windowed hard around the date so a promotion-slug
  // match can't attach last year's clip to this card.
  const [coveragePool, videos] = await Promise.all([
    getEventCoverage(coverageTerms(event.promotion, fights, event.name), 30),
    recommendVideos({
      promotions: [resolvePromotion(event.promotion).slug],
      fighterNames: fights.flatMap((f) => [f.red.name, f.blue.name]),
      publishedAfter: new Date(eventDate.getTime() - 21 * 86_400_000),
      publishedBefore: new Date(eventDate.getTime() + 10 * 86_400_000),
      viewerId: opts.viewerId ?? null,
      phase,
      limit: 4,
    }),
  ]);

  // Relevance ranking is pure and cheap — the main event weighs most, so a
  // promotion-wide story that names nobody on the card is dropped, not surfaced.
  const coverage = rankCoverage(
    coveragePool,
    {
      fighters: fights.flatMap((f) => [f.red.name, f.blue.name]),
      mainFighters: headline ? [headline.red.name, headline.blue.name] : [],
      eventName: event.name,
      eventDate: event.date,
    },
    8,
  );

  const officialResult = phase === "post" ? officialResultFrom(headline) : null;
  const heroVideo = selectHeroVideo(videos, phase);
  const featuredCoverage = coverage[0] ?? null;

  return {
    phase,
    coverage,
    featuredCoverage,
    videos,
    heroVideo,
    officialResult,
    coverageCount: coverage.length,
    videoCount: videos.length,
    confidence: enrichmentConfidence({
      phase,
      officialResult,
      heroVideo,
      featuredCoverage,
      coverageCount: coverage.length,
      videoCount: videos.length,
    }),
    lastEnrichedAt: new Date(now).toISOString(),
  };
}
