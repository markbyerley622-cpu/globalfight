// ════════════════════════════════════════════════════════════════════════
//  Neutral, locally generated placeholders.
//
//  Replaces ~7,635 re-hosted fighter photographs and every hotlinked publisher
//  cover image. Properties that matter:
//
//    • generated from the subject's NAME only — no likeness, no copied image
//    • deterministic: the same person always gets the same tile
//    • zero network requests: an inline SVG data URI, nothing fetched at render
//    • no third-party service (no ui-avatars, no gravatar — those are an external
//      request carrying our users' names to someone else's server)
//    • drop-in for the existing layouts; no visual redesign
// ════════════════════════════════════════════════════════════════════════

/** Stable hash → a hue. Same name, same colour, forever. */
function hueOf(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

/** "Conor McGregor" → "CM". Falls back to the first character. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const svgToDataUri = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\s+/g, " ").trim())}`;

/**
 * A person tile: initials on a muted, deterministic background.
 *
 * Deliberately NOT a photo-like silhouette of a real person — an abstract mark
 * cannot be mistaken for a likeness.
 */
export function personPlaceholder(name: string, size = 512): string {
  const hue = hueOf(name || "unknown");
  const initials = initialsOf(name || "?");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100" role="img">
      <rect width="100" height="100" fill="hsl(${hue} 18% 16%)"/>
      <rect width="100" height="100" fill="hsl(${hue} 32% 42%)" opacity="0.18"/>
      <text x="50" y="50" fill="hsl(${hue} 22% 74%)"
            font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif"
            font-size="34" font-weight="700" letter-spacing="1"
            text-anchor="middle" dominant-baseline="central">${initials}</text>
    </svg>`;
  return svgToDataUri(svg);
}

/** 16:9 hero variant of the same tile, so hero layouts keep their aspect ratio. */
export function personHeroPlaceholder(name: string): string {
  const hue = hueOf(name || "unknown");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 160 90" role="img">
      <rect width="160" height="90" fill="hsl(${hue} 18% 14%)"/>
      <rect width="160" height="90" fill="hsl(${hue} 30% 40%)" opacity="0.14"/>
    </svg>`;
  return svgToDataUri(svg);
}

/**
 * Neutral category artwork for a news item.
 *
 * Publisher cover images used to be HOTLINKED straight from the publisher's server
 * into a CSS `background-image` — which also bypassed next/image's remotePatterns
 * allow-list entirely. That is unlicensed display and bandwidth taken from the
 * publisher. We render our own artwork and link the reader to the source instead.
 */
export function newsPlaceholder(seed: string): string {
  const hue = hueOf(seed || "news");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 160 90" role="img">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="hsl(${hue} 24% 18%)"/>
          <stop offset="1" stop-color="hsl(${(hue + 40) % 360} 24% 11%)"/>
        </linearGradient>
      </defs>
      <rect width="160" height="90" fill="url(#g)"/>
      <rect x="14" y="40" width="46" height="2.5" rx="1.25" fill="hsl(${hue} 20% 60%)" opacity="0.5"/>
      <rect x="14" y="48" width="30" height="2.5" rx="1.25" fill="hsl(${hue} 20% 60%)" opacity="0.3"/>
    </svg>`;
  return svgToDataUri(svg);
}

/** Alt text that describes what the reader is actually looking at. Never a fake caption. */
export const placeholderAlt = (name: string) => `${name} — no photograph available`;

// ── Branded feed artwork ────────────────────────────────────────────────────
//
// The Following feed is image-first, and the data says the image is usually
// OURS to make: 559 of 10,902 published articles carry a usable cover, and 84
// of 2,124 fighters have a photograph. So generated artwork is not the fallback
// path here — it IS the path, and it has to look deliberate rather than empty.
//
// Three things make it look deliberate: the promotion's own brand colour, a
// discipline glyph, and the wordmark. Same seed always yields the same tile, so
// a card does not change appearance between renders.

/** Minimal, abstract discipline glyphs. Drawn, never emoji — an emoji in a
 *  16:9 hero is the thing that made the old feed look like a database dump. */
const GLYPH: Record<string, string> = {
  mma: "M20 46h30M35 31v30",
  boxing: "M28 34h14a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6H28a6 6 0 0 1-6-6v-8a6 6 0 0 1 6-6z",
  "muay-thai": "M24 54l10-22 10 22M28 46h12",
  kickboxing: "M24 54l10-22 10 22M28 46h12",
  "bare-knuckle": "M26 38h16v14a8 8 0 0 1-16 0z",
  bjj: "M22 44a13 13 0 0 1 26 0 13 13 0 0 1-26 0z",
  "no-gi-bjj": "M22 44a13 13 0 0 1 26 0 13 13 0 0 1-26 0z",
  wrestling: "M24 52c6-10 16-10 22 0M30 36a5 5 0 1 0 10 0 5 5 0 1 0-10 0z",
  judo: "M25 35l20 20M45 35L25 55",
  taekwondo: "M25 35l20 20M45 35L25 55",
};

/**
 * A 16:9 branded hero tile.
 *
 * @param seed     stable input (a slug) — same seed, same tile, forever
 * @param accent   the promotion's brand colour, when there is one
 * @param sport    discipline slug, for the glyph
 */
export function brandedHero(seed: string, accent?: string | null, sport?: string | null): string {
  const hue = hueOf(seed || "combat");
  const tint = accent && /^#[0-9a-f]{6}$/i.test(accent) ? accent : `hsl(${hue} 45% 40%)`;
  const glyph = (sport && GLYPH[sport]) || GLYPH.mma;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 160 90" role="img">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="hsl(${hue} 20% 15%)"/>
          <stop offset="1" stop-color="hsl(${(hue + 30) % 360} 22% 9%)"/>
        </linearGradient>
      </defs>
      <rect width="160" height="90" fill="url(#bg)"/>
      <rect width="160" height="90" fill="${tint}" opacity="0.14"/>
      <g transform="translate(45 12) scale(0.75)" stroke="${tint}" stroke-width="3.2"
         stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.85">
        <path d="${glyph}"/>
      </g>
      <rect x="0" y="86" width="160" height="4" fill="${tint}" opacity="0.5"/>
      <text x="152" y="82" text-anchor="end"
            font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif"
            font-size="4.4" font-weight="700" letter-spacing="1.1"
            fill="#ffffff" opacity="0.45">COMBAT REVIEWS</text>
    </svg>`;
  return svgToDataUri(svg);
}
