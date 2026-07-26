import "server-only";
import { cache } from "react";
import type { Article, Fight, FightEvent } from "@/lib/types";
import { getEventCoverage } from "@/lib/repo";
import { rankCoverage } from "@/lib/event-format";
import { recommendVideos, type VideoRec } from "@/lib/feed/recommend";
import { resolvePromotion } from "@/lib/promotions";
import { resolveEventEntities } from "@/lib/entities/registry";
import type { EventEntities } from "@/lib/entities/resolve";
import { resolveEventMedia, cardFighterImage, type EventMedia } from "@/lib/events/media-resolver";
import {
  coverageTermsFor,
  videoMatchTerms,
  enrichmentNavigation,
  eventStats,
  officialResultFrom,
  selectHeroVideo,
  enrichmentConfidence,
  type EnrichmentNavigation,
  type EventPhase,
  type EventStats,
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
//  REGISTRY-FIRST. The spine of this object is `entities`: the card's fighters,
//  promotion and venue resolved to canonical registry ids BEFORE any matching
//  happens (see lib/entities). Coverage terms, coverage relevance and video
//  matching are all driven from those resolved entities' own surfaces — registry
//  aliases and nicknames included — rather than from the single name string on
//  the fight row. Deterministic text matching remains the documented fallback for
//  the cases where nothing canonical exists, and it says so via `via: "text_only"`.
//
//  Everything returned is evidence-backed: the result is the stored winner, the
//  hero is a real highlight whose title says so, the coverage names a fighter on
//  the card. Nothing here is generated or inferred.
// ════════════════════════════════════════════════════════════════════════════

export type { OfficialResult, EventPhase } from "@/lib/events/enrichment-derive";

/**
 * Enrichment logic version. BUMP THIS whenever a rule that shapes the output
 * changes — new relevance weights, a new hero rule, a wider entity surface.
 *
 * It exists so a cached enrichment can be invalidated by LOGIC change, not only
 * by data change. Without it, a cache keyed on the event would keep serving an
 * object built by rules that no longer exist, and the bug would look like bad
 * data rather than a stale computation.
 */
export const ENRICHMENT_VERSION = 2;

export interface EventEnrichment {
  /** Enrichment logic version this object was built by (see ENRICHMENT_VERSION). */
  version: number;
  /** "post" once the card has happened, else "pre" — drives ordering everywhere. */
  phase: EventPhase;

  /**
   * The canonical entities behind this card — fighters, promotion, venue —
   * resolved to registry ids. Every matcher downstream should consume THIS, not
   * re-derive names from the fight rows.
   */
  entities: EventEntities;

  /** The verified main-event outcome (post only, null when none is recorded). */
  officialResult: OfficialResult | null;
  /** The one clip to feature — the top highlight on a completed card, else null. */
  heroVideo: VideoRec | null;
  /** The single lead story, or null. */
  featuredCoverage: Article | null;

  /** Ranked, deduped, relevance-filtered coverage (main-event stories weigh most). */
  coverage: Article[];
  /** Phase-ordered videos for this card (highlights lead post-fight). */
  videos: VideoRec[];

  /** 0–100 completeness of this enrichment (see enrichmentConfidence). */
  confidence: number;

  /** The event's resolved card artwork — one decision, shared with the cards. */
  media: EventMedia;
  /** Counts over the card, including the honest pending-result count. */
  stats: EventStats;
  /** The sections this event can support, derived from what was found. */
  navigation: EnrichmentNavigation;

  coverageCount: number;
  videoCount: number;
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

  // STEP 1 — resolve identity first. Everything after this point matches against
  // canonical entities and their registry surfaces, never against a raw string.
  // One extra query (the alias batch); the fighter rows are already in hand.
  const entities = await resolveEventEntities(event, fights);

  // STEP 2 — two independent reads run concurrently; the coverage pool is cached,
  // the video read is per-viewer. Both are driven by the resolved surface: the
  // coverage query searches registry aliases and nicknames, and the video query
  // matches on them too, so "AJ" and "The Gypsy King" reach the same card as the
  // canonical names do. Windowed hard around the date so a promotion-slug match
  // can't attach last year's clip to this card.
  const [coveragePool, videos] = await Promise.all([
    getEventCoverage(coverageTermsFor(entities, event.name), 30),
    recommendVideos({
      promotions: [resolvePromotion(event.promotion).slug],
      // Registry-first: alias/nickname forms too, not just the card's name string.
      // Bounded and main-event-first (videoMatchTerms) because each term is one
      // more `title contains` branch.
      fighterNames: videoMatchTerms(entities),
      publishedAfter: new Date(eventDate.getTime() - 21 * 86_400_000),
      publishedBefore: new Date(eventDate.getTime() + 10 * 86_400_000),
      viewerId: opts.viewerId ?? null,
      phase,
      limit: 4,
    }),
  ]);

  // STEP 3 — relevance ranking is pure and cheap. Registry-first: an article is
  // scored on which RESOLVED fighter it names (any of their known forms), the main
  // event weighing most, so a promotion-wide story that names nobody on the card
  // is dropped, not surfaced. The string fields stay populated as the documented
  // deterministic fallback for callers without resolved entities.
  const coverage = rankCoverage(
    coveragePool,
    {
      fighters: fights.flatMap((f) => [f.red.name, f.blue.name]),
      mainFighters: headline ? [headline.red.name, headline.blue.name] : [],
      eventName: event.name,
      eventDate: event.date,
      entities: {
        fighters: entities.fighters,
        main: entities.main ? [entities.main.red, entities.main.blue] : [],
      },
    },
    8,
  );

  const officialResult = phase === "post" ? officialResultFrom(headline) : null;
  const heroVideo = selectHeroVideo(videos, phase);
  const featuredCoverage = coverage[0] ?? null;
  const stats = eventStats(fights, phase, { coverage: coverage.length, videos: videos.length });

  return {
    version: ENRICHMENT_VERSION,
    phase,
    entities,
    officialResult,
    heroVideo,
    featuredCoverage,
    coverage,
    videos,
    confidence: enrichmentConfidence({
      phase,
      officialResult,
      heroVideo,
      featuredCoverage,
      coverageCount: coverage.length,
      videoCount: videos.length,
    }),
    media: resolveEventMedia(mediaInput(event, headline)),
    stats,
    navigation: enrichmentNavigation({
      slug: event.slug,
      boutCount: fights.length,
      coverageCount: coverage.length,
      videoCount: videos.length,
    }),
    coverageCount: coverage.length,
    videoCount: videos.length,
    lastEnrichedAt: new Date(now).toISOString(),
  };
}

/**
 * Adapt an event + its headline bout to the media resolver's input, so the event
 * page and the event card reach the SAME artwork decision from the same function
 * instead of each picking a background.
 */
function mediaInput(event: FightEvent, headline: Fight | undefined) {
  return {
    slug: event.slug,
    sport: event.sport,
    promotion: event.promotion ?? null,
    posterUrl: event.posterUrl ?? null,
    heroUrl: event.heroUrl ?? null,
    mainEvent: headline
      ? {
          red: headline.red.name,
          blue: headline.blue.name,
          titleFight: headline.titleFight,
          redImage: cardFighterImage(headline.red),
          blueImage: cardFighterImage(headline.blue),
          redRank: null,
          blueRank: null,
        }
      : null,
  };
}
