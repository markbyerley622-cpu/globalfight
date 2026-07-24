// Event-card imagery that DOESN'T depend on scraped fighter photos.
//
// In production the media-ingestion gate keeps scraped Wikimedia photos off the
// site, so most event cards have no hero, no poster and no fighter photo — they
// fall straight to a flat gradient. This module gives every card a real,
// intentional look two ways:
//
//   1. An OWNED stock face-off photo, shipped in /public/cards/<sport>/N.jpg.
//      Because we ship it ourselves it is fully licensed — safe under the media
//      gate that blocks third-party scraped images. Add files, bump the count
//      below, done. Picked deterministically per event so a card never flickers
//      and a sport's events spread across its whole set.
//
//   2. A sport-tuned ACCENT colour, so a boxing card reads gold, an MMA card
//      reads blood-red, a BJJ card reads blue — the generative fallback in
//      event-card.tsx uses this so image-less cards are still distinct by sport
//      instead of one shared grey mesh.

import { SPORTS } from "@/lib/sports";

// ── Owned card imagery ───────────────────────────────────────────────────────
// Explicit file manifests of OWNED artwork we ship in /public. Because we ship
// them ourselves they are safe under the media gate that blocks scraped images.
// Any extension is fine (list the real filenames). Add art by dropping files in
// /public/cards/... and listing them here.
//
// By PROMOTION slug (resolvePromotion) — a promotion's own event artwork, used
// for every card of that org that has no official poster:
//   drop /public/cards/promotions/one/1.png … and list them below.
// Empty by design — the owned-photo tiers are off. Cards use official posters /
// fighter faceoffs when available, else the generated promotion-tinted backdrop.
// To re-enable, drop files under /public/cards/promotions/<slug>/ or
// /public/cards/<sport>/ and list them here.
const PROMOTION_CARD_IMAGES: Record<string, string[]> = {};
const SPORT_CARD_IMAGES: Record<string, string[]> = {};

// FNV-1a — stable per-event pick (same event → same image, forever, no flicker).
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const SLUG_BY_VALUE: Record<string, string> = Object.fromEntries(
  SPORTS.map((s) => [s.value, s.slug]),
);

/** Deterministically pick one path from a list, seeded by the event slug. */
function pick(list: string[] | undefined, seed: string): string | null {
  if (!list || list.length === 0) return null;
  return list[hash(seed || "event") % list.length];
}

/**
 * OWNED artwork for a promotion (e.g. every ONE card rotates through ONE's promo
 * images), or null when none is shipped. `seed` = event slug for a stable pick.
 */
export function ownedPromotionImage(promotionSlug: string | null | undefined, seed: string): string | null {
  if (!promotionSlug) return null;
  return pick(PROMOTION_CARD_IMAGES[promotionSlug], seed);
}

/**
 * OWNED generic artwork for a sport, or null when the sport has none shipped.
 * `seed` = event slug so the choice is stable.
 */
export function ownedCardImage(sportValue: string | null | undefined, seed: string): string | null {
  const slug = sportValue ? SLUG_BY_VALUE[sportValue] : undefined;
  return pick(slug ? SPORT_CARD_IMAGES[slug] : undefined, seed);
}

// ── Sport accent colours ─────────────────────────────────────────────────────
// One signature colour per sport, so the generative fallback (and any card with
// no real promotion brand) still has a distinct, on-theme identity.
const SPORT_ACCENT: Record<string, string> = {
  MMA: "#e11d2a",          // blood red
  BOXING: "#d4a017",       // championship gold
  MUAY_THAI: "#16a34a",    // Thai green
  KICKBOXING: "#7c3aed",   // violet
  BARE_KNUCKLE: "#dc2626", // raw red
  BJJ: "#2563eb",          // blue belt
  BJJ_NOGI: "#0ea5e9",     // sky
  WRESTLING: "#ea580c",    // singlet orange
  JUDO: "#0b4ea2",         // IJF blue
  TAEKWONDO: "#0891b2",    // cyan
  SAMBO: "#b91c1c",        // sambo red
  COMBAT_SAMBO: "#9333ea", // purple
};

const DEFAULT_ACCENT = "#8a8f98";

/** Signature colour for a sport (enum value), for card artwork tinting. */
export function sportAccent(sportValue: string | null | undefined): string {
  return (sportValue && SPORT_ACCENT[sportValue]) || DEFAULT_ACCENT;
}
