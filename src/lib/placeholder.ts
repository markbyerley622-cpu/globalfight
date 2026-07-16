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
