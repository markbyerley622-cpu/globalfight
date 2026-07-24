import { sportAccent } from "@/lib/event-card-image";

// A DESIGNED fight-poster backdrop for cards that have no photo — rendered as
// inline SVG so it reads as intentional artwork, not a flat gradient. Every piece
// is seeded from the event slug (spotlight position, slash angle, grain), so no
// two cards look alike and a card never flickers between renders. Sport-tinted so
// boxing reads gold, MMA blood-red, BJJ blue, etc.

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const BASE = "#0b0e13";

export function SportPosterArt({
  seed, sportValue, label, idKey = "",
}: { seed: string; sportValue: string | null; label: string; idKey?: string }) {
  const accent = sportAccent(sportValue);
  const h = hash(seed || label || "event");
  // Namespaced ids so multiple cards on one page don't collide over <defs>.
  const id = `spa-${(h % 1_000_000).toString(36)}${idKey}`;
  const spotX = 22 + (h % 52);              // spotlight centre, 22–74%
  const spotY = 12 + ((h >> 5) % 42);       // 12–54%
  const slash = 8 + ((h >> 9) % 22);        // slash tilt, 8–30°
  const slashX = 40 + ((h >> 13) % 300);    // slash horizontal position

  return (
    <svg
      viewBox="0 0 400 160"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 size-full"
      aria-hidden
    >
      <defs>
        <radialGradient id={`${id}-spot`} cx={`${spotX}%`} cy={`${spotY}%`} r="78%">
          <stop offset="0%" stopColor={accent} stopOpacity="0.6" />
          <stop offset="42%" stopColor={accent} stopOpacity="0.16" />
          <stop offset="100%" stopColor={BASE} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="40%" stopColor={BASE} stopOpacity="0" />
          <stop offset="100%" stopColor={BASE} stopOpacity="0.9" />
        </linearGradient>
        <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>

      {/* Dark base */}
      <rect width="400" height="160" fill={BASE} />

      {/* Accent light slashes — energy diagonals, seeded position/angle */}
      <g transform={`rotate(${slash} 200 80)`}>
        <rect x={slashX} y="-40" width="34" height="240" fill={accent} opacity="0.12" />
        <rect x={slashX + 52} y="-40" width="12" height="240" fill={accent} opacity="0.08" />
        <rect x={slashX - 30} y="-40" width="6" height="240" fill={accent} opacity="0.06" />
      </g>

      {/* Spotlight */}
      <rect width="400" height="160" fill={`url(#${id}-spot)`} />

      {/* Oversized ghost wordmark of the sport */}
      <text
        x="384" y="128" textAnchor="end"
        fontSize="92" fontWeight="900" letterSpacing="-4"
        fontFamily="var(--font-display), system-ui, sans-serif"
        fill={accent} opacity="0.10"
        transform="rotate(-7 384 128)"
        style={{ textTransform: "uppercase" }}
      >
        {label}
      </text>

      {/* Film grain for texture */}
      <rect
        width="400" height="160"
        filter={`url(#${id}-grain)`}
        opacity="0.07"
        style={{ mixBlendMode: "overlay" }}
      />

      {/* Bottom fade so overlaid text always reads */}
      <rect width="400" height="160" fill={`url(#${id}-fade)`} />
    </svg>
  );
}
