import type { GeoPrecision } from "./gazetteer";

// ════════════════════════════════════════════════════════════════════════════
//  The Location pillar's one wire format.
//
//  Every layer on the map — events today, gyms and fight clubs next — produces
//  MapPin. The client map component knows nothing about events, promotions or
//  Prisma: it renders pins. Adding a layer is writing one more provider that
//  returns MapPin[]; the map does not change.
// ════════════════════════════════════════════════════════════════════════════

/** The pin families: red events, blue gyms, gold people, purple clubs. */
export type MapLayer = "events" | "gyms" | "people" | "clubs";

export const MAP_LAYERS: { id: MapLayer; label: string; short: string }[] = [
  { id: "events", label: "Events", short: "Event" },
  { id: "gyms", label: "Gyms", short: "Gym" },
  { id: "people", label: "People", short: "Person" },
  { id: "clubs", label: "Fight Clubs", short: "Fight Club" },
];

export interface MapPin {
  id: string;
  layer: MapLayer;
  name: string;
  /** Second line: promotion for an event, discipline for a gym. */
  subtitle: string | null;
  /** "Lumpinee Stadium · Bangkok, Thailand" */
  address: string | null;
  lat: number;
  lon: number;
  /** How trustworthy the coordinates are. Rendered honestly in the UI. */
  precision: GeoPrecision;
  /** ISO timestamp — events only. */
  date?: string | null;
  /** LIVE / UPCOMING / COMPLETED — events only. */
  status?: string | null;
  /** Registry slug, for the promotion crest. */
  promotion?: string | null;
  imageUrl?: string | null;
  /** In-app detail route. */
  href?: string | null;
  website?: string | null;
  /** Free-text search target for Directions when we lack a street address. */
  searchQuery: string;
  /** Badge text: "Gym Partner", "Title Fight", "Open Mat". */
  badge?: string | null;
  /** How many people are checked in here right now. Places only. */
  presentNow?: number;

  /** Set on people pins only — everything the person sheet renders. */
  person?: {
    userId: string;
    username: string | null;
    role: string;
    homeGym: { name: string; slug: string } | null;
    openToSpar: boolean;
    lookingForTraining: boolean;
  };

  /** Set on gym pins only. */
  gym?: {
    slug: string;
    verified: boolean;
    disciplines: string[];
    memberCount: number;
    /** True when the VIEWER trains here — drives the "Your gym" treatment. */
    viewerIsMember: boolean;
    isViewerHome: boolean;
  };

  /** Set on fight-club pins only. */
  club?: {
    slug: string;
    memberCount: number;
    meetsOn: string | null;
    viewerIsMember: boolean;
  };
}

/** A pin whose city/country we could not place — listed, never mis-pinned. */
export interface UnmappedPin {
  id: string;
  layer: MapLayer;
  name: string;
  subtitle: string | null;
  place: string | null;
  href?: string | null;
}

export interface MapData {
  pins: MapPin[];
  unmapped: UnmappedPin[];
  /** Per-layer totals, including layers with nothing in them yet. */
  counts: Record<MapLayer, number>;
  /** Layers with nothing in them — drives the empty state. */
  pending: MapLayer[];
  /** Signed-out viewers see the PUBLIC slice only; the UI says so rather than
   *  presenting a thin map as the whole community. */
  signedIn: boolean;
}

/** Google Maps directions URL. Uses the search query, not a raw lat/lon, when
 *  the coordinates are only city-accurate — sending a driver to a city centroid
 *  labelled as a venue would be worse than useless. */
export function directionsUrl(pin: MapPin): string {
  const q = pin.precision === "city" || pin.precision === "country"
    ? pin.searchQuery
    : `${pin.lat},${pin.lon}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}
