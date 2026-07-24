// Deterministic, UNIQUE-per-event fallback background. When an event has no hero,
// poster or fighter photos, it should still get a distinct "custom" backdrop —
// not every card sharing one identical flat gradient. This seeds a layered mesh
// gradient from the event's slug + its promotion brand colour: stable across
// renders (no flicker / layout shift), no network, no two events alike.

// FNV-1a — a tiny, stable string hash. Same slug → same art, forever.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A unique CSS `background` value for an event, tinted by its promotion colour.
 * Two brand-tinted radial "lights" at seeded positions + a seeded diagonal sheen
 * over a dark base — reads as intentional custom artwork, and every event's is
 * different because the seed comes from its slug.
 */
export function eventFallbackArt(seed: string, accent: string): string {
  const h = hash(seed || "event");
  const angle = h % 360;
  const p1x = 12 + (h % 44);
  const p1y = 8 + ((h >> 3) % 34);
  const p2x = 55 + ((h >> 6) % 40);
  const p2y = 35 + ((h >> 9) % 50);
  const base = "#0b0e13";
  return [
    `radial-gradient(120% 130% at ${p1x}% ${p1y}%, color-mix(in srgb, ${accent} 55%, transparent), transparent 58%)`,
    `radial-gradient(90% 95% at ${p2x}% ${p2y}%, color-mix(in srgb, ${accent} 28%, ${base}), transparent 62%)`,
    `linear-gradient(${angle}deg, color-mix(in srgb, ${accent} 16%, transparent), transparent 55%)`,
    base,
  ].join(", ");
}
