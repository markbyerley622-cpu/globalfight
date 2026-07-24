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

// ── Owned stock imagery ──────────────────────────────────────────────────────
// How many owned face-off photos exist for each sport SLUG. 0 = none yet, so the
// card uses the generative sport-accent fallback. To add art: drop
// /public/cards/boxing/1.jpg, /public/cards/boxing/2.jpg … then set boxing: 2.
// Landscape (~16:9), dark/high-contrast reads best behind the card overlay.
const CARD_IMAGE_COUNTS: Record<string, number> = {
  mma: 0,
  boxing: 0,
  "muay-thai": 0,
  kickboxing: 0,
  "bare-knuckle": 0,
  bjj: 0,
  "no-gi-bjj": 0,
  wrestling: 0,
  judo: 0,
  taekwondo: 0,
  sambo: 0,
  "combat-sambo": 0,
};

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

/**
 * A deterministic OWNED card image for an event, or null when the sport has no
 * shipped art yet. `seed` should be the event slug so the choice is stable.
 */
export function ownedCardImage(sportValue: string | null | undefined, seed: string): string | null {
  const slug = sportValue ? SLUG_BY_VALUE[sportValue] : undefined;
  if (!slug) return null;
  const n = CARD_IMAGE_COUNTS[slug] ?? 0;
  if (n <= 0) return null;
  const idx = (hash(seed || slug) % n) + 1;
  return `/cards/${slug}/${idx}.jpg`;
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
