import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";
import { SITE } from "@/lib/config";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = `${SITE.name} — every combat sport, one place`;

// ════════════════════════════════════════════════════════════════════════════
//  The DEFAULT share card.
//
//  ── What this replaces, and why it had to ─────────────────────────────────
//  Every page without a card of its own — news, leaderboard, today, schedule,
//  results, forums, gyms, rankings, the registry, the legal pages — unfurled
//  with the static `public/og-default.png`. That file was cut before the
//  rename: it reads "COMBAT REGISTER". So the single most-shared image in the
//  product was advertising a name that no longer exists, while the six
//  generated cards beside it were correctly branded.
//
//  Rendering it instead of shipping a bitmap means the wordmark and the mark
//  come from BrandLockup like every other card, so this can never drift out of
//  brand again — a rename is one edit in one place, not a designer round-trip.
//
//  ── Why the file convention rather than a URL in the root metadata ────────
//  `opengraph-image.tsx` CASCADES: a nested segment that declares its own uses
//  it, and every segment that does not inherits this one. That is exactly the
//  fallback shape wanted here, and it is the same mechanism the seven existing
//  cards already use. The root layout's explicit `openGraph.images` was removed
//  in the same change, because an explicit `images` SHADOWS the convention —
//  the identical trap the `twitter.images` comment in layout.tsx documents.
// ════════════════════════════════════════════════════════════════════════════

export default async function Image() {
  return renderOgCard({
    // No eyebrow. BrandLockup already prints "Combat Reviews" top-right on every
    // card, and putting the site name in the eyebrow too rendered it twice on
    // one image, once in each upper corner.
    headline: "Every combat sport, one place",
    sub: "See what's upcoming. See what people think.",
    chips: ["Boxing", "MMA", "Muay Thai", "Kickboxing"],
  });
}
