// Deterministic event-card artwork selection.
//
// One card should NEVER be an empty gradient when real imagery exists. This picks
// the best available background for an event card, in a fixed priority order so
// the choice is stable across renders (no layout shift, no flicker):
//
//   1. heroUrl     — official 16:9 event artwork (best fit for the landscape slot)
//   2. posterUrl   — official vertical fight poster (cover-cropped from the top)
//   3. fighters    — the two main-event fighters' photos, composed facing centre
//   4. one fighter — a single fighter photo, when only one side has one
//   5. gradient    — promotion brand colour, the LAST resort
//
// Priorities 1–4 are data we already have on the card. Article-hero and dedicated
// promotion-branding artwork (the plan's tiers 3/4/6) are a future enrichment —
// they need extra joins — and would slot in ahead of the gradient.

export type EventArtwork =
  | { kind: "hero"; src: string }
  | { kind: "poster"; src: string }
  | { kind: "fighters"; red: string | null; blue: string | null }
  | { kind: "gradient" };

export interface ArtworkInput {
  heroUrl: string | null;
  posterUrl: string | null;
  mainEvent: { redImage: string | null; blueImage: string | null } | null;
}

export function pickEventArtwork(e: ArtworkInput): EventArtwork {
  if (e.heroUrl) return { kind: "hero", src: e.heroUrl };
  if (e.posterUrl) return { kind: "poster", src: e.posterUrl };

  const red = e.mainEvent?.redImage ?? null;
  const blue = e.mainEvent?.blueImage ?? null;
  if (red || blue) return { kind: "fighters", red, blue };

  return { kind: "gradient" };
}
