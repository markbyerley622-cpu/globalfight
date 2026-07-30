import { pickEventArtwork } from "@/lib/event-artwork";
import { ownedPromotionImage, ownedCardImage } from "@/lib/event-card-image";
import { resolvePromotion } from "@/lib/promotions";
import { safeFighterImageOrNull, imageProxyUrl } from "@/lib/media-safe";
import type { EventCard } from "@/lib/events-query";

// ════════════════════════════════════════════════════════════════════════
//  EventMediaResolver — the SINGLE source of truth for an event's card media.
//  One pure function, one priority order, so every surface (card, event page,
//  following, search) shows the same thing and the fallback is always
//  intentional — never a bare gradient, never a random wallpaper.
//
//  Priority (fighter-forward, per the editorial direction):
//    official event artwork (hero → poster)
//      → fighter faceoff (only when a real photo exists)
//      → owned promotion artwork (e.g. ONE's own event imagery)
//      → owned sport artwork
//      → generated premium backdrop (promotion-tinted; handled by the card)
// ════════════════════════════════════════════════════════════════════════

export type EventMedia =
  | { kind: "image"; src: string; source: "hero" | "poster" | "promotion" | "sport"; position: "top" | "center" }
  | { kind: "faceoff"; red: string | null; blue: string | null }
  | { kind: "generated" };

// The resolver picks ARTWORK, so it depends only on the two fighter images — not on
// the whole `mainEvent` shape. Widening `mainEvent` with fields this module never
// reads (slugs, records) otherwise breaks every caller and test that constructs a
// minimal fixture, for a property the resolver has no opinion about.
type MediaInput = Pick<EventCard, "slug" | "sport" | "promotion" | "posterUrl" | "heroUrl"> & {
  mainEvent: Pick<NonNullable<EventCard["mainEvent"]>, "redImage" | "blueImage"> | null;
};

export function resolveEventMedia(event: MediaInput): EventMedia {
  const art = pickEventArtwork(event); // hero | poster | fighters | gradient

  if (art.kind === "hero") return { kind: "image", src: art.src, source: "hero", position: "center" };
  if (art.kind === "poster") return { kind: "image", src: art.src, source: "poster", position: "top" };

  // Real fighter photos → compose the faceoff.
  if (art.kind === "fighters") return { kind: "faceoff", red: art.red, blue: art.blue };

  // No photos: owned promotion artwork, then owned sport artwork.
  const promo = ownedPromotionImage(resolvePromotion(event.promotion).slug, event.slug);
  if (promo) return { kind: "image", src: promo, source: "promotion", position: "center" };

  const sport = ownedCardImage(event.sport, event.slug);
  if (sport) return { kind: "image", src: sport, source: "sport", position: "center" };

  return { kind: "generated" };
}

/**
 * A fighter's display image for card media: own storage → proxied licensed
 * Wikimedia photo → null. Lives beside the resolver because every surface that
 * builds a MediaInput needs it, and two copies of this precedence is how the
 * event page and the event card start disagreeing about what a card looks like.
 */
export function cardFighterImage(f: {
  imageUrl?: string | null;
  thumbUrl?: string | null;
  photoUrl?: string | null;
  photoLicense?: string | null;
}): string | null {
  return (
    safeFighterImageOrNull(f.imageUrl ?? f.thumbUrl) ??
    (!f.imageUrl && f.photoLicense ? imageProxyUrl(f.photoUrl) : null)
  );
}
