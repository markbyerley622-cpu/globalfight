import "server-only";
import { prisma } from "@/lib/db";
import { PUBLIC_EVENT } from "@/lib/events-visibility";
import { resolvePromotion } from "@/lib/promotions";
import { resolvePoint } from "./gazetteer";
import { gymPins, clubPins } from "./gyms";
import { loadViewer, peoplePins } from "./people";
import { getPresenceCounts } from "./presence";
import type { MapData, MapLayer, MapPin, UnmappedPin } from "./types";

// ════════════════════════════════════════════════════════════════════════════
//  Location — the pin providers.
//
//  One provider per layer, each returning { pins, unmapped }. The page composes
//  them; nothing downstream knows which layer a pin came from.
//
//  Every provider takes the VIEWER, because three of the four layers answer
//  differently depending on who is asking — people are privacy-gated, gyms and
//  clubs mark the viewer's own membership. The viewer is loaded ONCE and passed
//  down rather than re-derived per layer.
// ════════════════════════════════════════════════════════════════════════════

interface LayerResult {
  pins: MapPin[];
  unmapped: UnmappedPin[];
}

/** How far ahead/back the map looks. A map of last year's cards is a museum. */
const WINDOW_AHEAD_DAYS = 180;
const WINDOW_BACK_DAYS = 14;
const MAX_EVENT_PINS = 400;

// ── Layer: Events ─────────────────────────────────────────────────────────
async function eventPins(): Promise<LayerResult> {
  const now = new Date();
  const rows = await prisma.event.findMany({
    where: {
      ...PUBLIC_EVENT,
      status: { notIn: ["DRAFT", "CANCELLED"] },
      date: {
        gte: new Date(now.getTime() - WINDOW_BACK_DAYS * 86_400_000),
        lte: new Date(now.getTime() + WINDOW_AHEAD_DAYS * 86_400_000),
      },
    },
    orderBy: { date: "asc" },
    take: MAX_EVENT_PINS,
    select: {
      id: true, slug: true, name: true, date: true, status: true, promotion: true,
      venue: true, city: true, country: true, countryCode: true, posterUrl: true,
    },
  });

  const present = await getPresenceCounts("event", rows.map((e) => e.id));
  const pins: MapPin[] = [];
  const unmapped: UnmappedPin[] = [];

  for (const e of rows) {
    const promo = resolvePromotion(e.promotion);
    const place = [e.venue, e.city, e.country].filter(Boolean).join(" · ") || null;
    const point = resolvePoint(e);

    if (!point) {
      unmapped.push({
        id: e.id,
        layer: "events",
        name: e.name,
        subtitle: promo.name,
        place,
        href: `/events/${e.slug}`,
      });
      continue;
    }

    pins.push({
      id: e.id,
      layer: "events",
      name: e.name,
      subtitle: promo.name,
      address: place,
      lat: point.lat,
      lon: point.lon,
      precision: point.precision,
      date: e.date.toISOString(),
      status: e.status,
      promotion: e.promotion,
      imageUrl: e.posterUrl,
      href: `/events/${e.slug}`,
      // Directions target the NAMED venue, not the city centroid we pinned —
      // see the note in gazetteer.ts about city-level precision.
      searchQuery: [e.venue, e.city, e.country].filter(Boolean).join(", ") || e.name,
      badge: e.status === "LIVE" ? "Live now" : null,
      presentNow: present.get(e.id) ?? 0,
    });
  }

  return { pins, unmapped };
}

/**
 * Everything the Location page renders, in one round of parallel reads.
 *
 * A provider that throws yields an EMPTY layer, not a 500. One layer's data
 * source falling over must not take the map — or the other layers — down with
 * it; the layer renders its empty state and the rest of the page is unaffected.
 */
export async function getMapData(viewerId: string | null): Promise<MapData> {
  const viewer = await loadViewer(viewerId);

  const providers: Record<MapLayer, () => Promise<LayerResult>> = {
    events: eventPins,
    gyms: () => gymPins(viewerId),
    people: () => peoplePins(viewer),
    clubs: () => clubPins(viewerId),
  };

  const entries = Object.entries(providers) as [MapLayer, () => Promise<LayerResult>][];
  const results = await Promise.all(
    entries.map(async ([layer, fn]) => {
      try {
        return [layer, await fn()] as const;
      } catch (err) {
        console.error(`[map] layer "${layer}" failed:`, err);
        return [layer, { pins: [], unmapped: [] } as LayerResult] as const;
      }
    }),
  );

  const pins: MapPin[] = [];
  const unmapped: UnmappedPin[] = [];
  const counts = { events: 0, gyms: 0, people: 0, clubs: 0 } as Record<MapLayer, number>;
  const pending: MapLayer[] = [];

  for (const [layer, result] of results) {
    pins.push(...result.pins);
    unmapped.push(...result.unmapped);
    counts[layer] = result.pins.length + result.unmapped.length;
    if (counts[layer] === 0) pending.push(layer);
  }

  return { pins, unmapped, counts, pending, signedIn: !!viewerId };
}
