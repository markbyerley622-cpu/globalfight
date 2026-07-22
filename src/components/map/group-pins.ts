import type { MapLayer, MapPin } from "@/lib/geo/types";

// ════════════════════════════════════════════════════════════════════════════
//  Pin grouping.
//
//  Coordinates are city-level for events and people, so eight UFC cards in Las
//  Vegas land on the exact same point — eight markers stacked into one, seven of
//  them unclickable. Grouping is therefore not an optimisation, it is
//  correctness: one marker per place, carrying everything at that place.
//
//  Groups are MIXED. An earlier version grouped per layer, which put a red pin,
//  a blue pin and a gold pin on the same coordinate in Bangkok — three markers
//  fighting for one spot, none of them telling you there were two others. A
//  place is a place: one marker, "12 people · 3 gyms · 1 event".
// ════════════════════════════════════════════════════════════════════════════

export interface PinGroup {
  id: string;
  /** The layer that owns the marker's colour: the rarest thing present. */
  layer: MapLayer;
  /** Every layer present, with counts — drives the mixed-cluster label. */
  breakdown: { layer: MapLayer; count: number }[];
  lat: number;
  lon: number;
  /** Shared place label when every pin agrees on one, else null. */
  place: string | null;
  /** Anyone checked in across everything here, right now. */
  presentNow: number;
  pins: MapPin[];
}

/** Degrees per grid cell at a given zoom. Below zoom 9 nothing merges. */
function cellSize(zoom: number): number {
  if (zoom >= 9) return 0;
  if (zoom >= 7) return 0.15;
  if (zoom >= 5) return 0.6;
  if (zoom >= 4) return 1.5;
  return 3;
}

/**
 * Which layer a mixed marker takes its colour from.
 *
 * Rarest-wins, not most-numerous: a city with 40 people and one live event
 * should read as an EVENT city. Colouring by majority would drown every signal
 * that matters under the layer that always has the most rows.
 */
const PRIORITY: MapLayer[] = ["events", "clubs", "gyms", "people"];

export function groupPins(pins: MapPin[], zoom: number): PinGroup[] {
  const size = cellSize(zoom);
  const buckets = new Map<string, MapPin[]>();

  for (const p of pins) {
    const cell = size === 0
      ? `${p.lat.toFixed(4)}:${p.lon.toFixed(4)}`
      : `${Math.round(p.lat / size)}:${Math.round(p.lon / size)}`;
    const bucket = buckets.get(cell);
    if (bucket) bucket.push(p);
    else buckets.set(cell, [p]);
  }

  const groups: PinGroup[] = [];
  for (const [id, group] of buckets) {
    // Anchor the marker on the group's centroid, not on whichever pin sorted
    // first — a cluster label that sits off to one side reads as a mistake.
    const lat = group.reduce((s, p) => s + p.lat, 0) / group.length;
    const lon = group.reduce((s, p) => s + p.lon, 0) / group.length;
    const places = new Set(group.map(cityOf).filter(Boolean));

    const counts = new Map<MapLayer, number>();
    for (const p of group) counts.set(p.layer, (counts.get(p.layer) ?? 0) + 1);
    const breakdown = PRIORITY.filter((l) => counts.has(l)).map((l) => ({ layer: l, count: counts.get(l)! }));

    groups.push({
      id,
      layer: breakdown[0]?.layer ?? "events",
      breakdown,
      lat,
      lon,
      place: places.size === 1 ? [...places][0]! : null,
      presentNow: group.reduce((s, p) => s + (p.presentNow ?? 0), 0),
      pins: [...group].sort(byRelevance),
    });
  }

  // Bigger groups render last so their count ring is never hidden behind a
  // single pin that happens to overlap it.
  return groups.sort((a, b) => a.pins.length - b.pins.length);
}

/** "Bangkok, Thailand" out of "Lumpinee Stadium · Bangkok · Thailand". */
function cityOf(p: MapPin): string | null {
  if (!p.address) return null;
  const parts = p.address.split(" · ").map((s) => s.trim()).filter(Boolean);
  return parts.slice(-2).join(", ") || null;
}

/**
 * Live, then soonest, then places with people in them, then alphabetical.
 * Shared by groups and the sheet's lists so ordering never disagrees.
 */
export function byRelevance(a: MapPin, b: MapPin): number {
  const liveA = a.status === "LIVE" ? 0 : 1;
  const liveB = b.status === "LIVE" ? 0 : 1;
  if (liveA !== liveB) return liveA - liveB;
  if (a.date && b.date) return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  if (a.date) return -1;
  if (b.date) return 1;
  const presence = (b.presentNow ?? 0) - (a.presentNow ?? 0);
  if (presence !== 0) return presence;
  return a.name.localeCompare(b.name);
}

/** "12 people · 3 gyms" — the mixed-cluster caption. */
export function describeGroup(g: PinGroup): string {
  const LABEL: Record<MapLayer, [string, string]> = {
    events: ["event", "events"],
    gyms: ["gym", "gyms"],
    people: ["person", "people"],
    clubs: ["club", "clubs"],
  };
  return g.breakdown
    .map(({ layer, count }) => `${count} ${LABEL[layer][count === 1 ? 0 : 1]}`)
    .join(" · ");
}
