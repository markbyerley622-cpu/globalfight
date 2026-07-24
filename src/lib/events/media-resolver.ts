import { pickEventArtwork } from "@/lib/event-artwork";
import { ownedPromotionImage, ownedCardImage } from "@/lib/event-card-image";
import { resolvePromotion } from "@/lib/promotions";
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

type MediaInput = Pick<EventCard, "slug" | "sport" | "promotion" | "posterUrl" | "heroUrl" | "mainEvent">;

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
