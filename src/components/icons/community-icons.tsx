// ═══════════════════════════════════════════════════════════════════════════
//  Combat Reviews — custom community iconography
//
//  One bespoke, stroke-based glyph per combat-sport community. Built to match
//  the lucide icon set (24×24 viewBox, `currentColor` stroke, 2px weight, round
//  caps/joins, no fill) so they drop in wherever a lucide icon would and inherit
//  the surrounding text colour (idle mist → active blood-red).
//
//  Lucide has no distinct mark for Muay Thai vs BJJ vs Judo vs Sambo, so these
//  give every community its own recognisable identity:
//    mma → octagon cage · boxing → glove · muay-thai → mongkol headband
//    kickboxing → roundhouse kick · bare-knuckle → bare fist · bjj → belt knot
//    wrestling → ear-guard headgear · judo → gi (kimono) · taekwondo → breaking
//    board · sambo → sambovki boot · general → speech bubbles · industry →
//    briefcase.
//
//  Keyed by community slug (see FORUM_CATEGORY_SEED). Resolve via
//  <CategoryIcon> — do not import these directly in feature code.
// ═══════════════════════════════════════════════════════════════════════════

import { cn } from "@/lib/utils";

export type CommunityIconProps = { className?: string };

// Shared SVG frame: matches lucide's presentation attributes exactly so a
// `size-*` / `text-*` className on the call site controls dimensions + colour.
function Glyph({ className, children }: CommunityIconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("size-4", className)}
    >
      {children}
    </svg>
  );
}

// MMA — the octagon cage.
export function MmaIcon(p: CommunityIconProps) {
  return (
    <Glyph {...p}>
      <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z" />
    </Glyph>
  );
}

// Boxing — a laced glove with cuff.
export function BoxingIcon(p: CommunityIconProps) {
  return (
    <Glyph {...p}>
      <path d="M8.5 4h3a5 5 0 0 1 5 5v2.5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9a5 5 0 0 1 4.5-5z" />
      <path d="M4 12.5a2 2 0 0 0 0 3" />
      <path d="M8 15.5h6v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z" />
    </Glyph>
  );
}

// Muay Thai — the mongkol (ceremonial headband) worn on the head, tails hanging.
export function MuayThaiIcon(p: CommunityIconProps) {
  return (
    <Glyph {...p}>
      <path d="M4 13c0-5 3.6-8 8-8s8 3 8 8" />
      <path d="M4 13h16" />
      <circle cx="12" cy="4.6" r="1.2" />
      <path d="M8 13.5l-1.3 5.5" />
      <path d="M16 13.5l1.3 5.5" />
    </Glyph>
  );
}

// Kickboxing — a bent leg mid roundhouse (hip → knee → foot).
export function KickboxingIcon(p: CommunityIconProps) {
  return (
    <Glyph {...p}>
      <circle cx="7" cy="5" r="1.4" />
      <path d="M7.7 6.1l6.3 5" />
      <circle cx="14.6" cy="11.4" r="1.4" />
      <path d="M13.9 12.6l-4 5.6" />
      <path d="M9.9 18.2l5 1.6" />
      <path d="M9.9 18.2l-2.4 1" />
    </Glyph>
  );
}

// Bare Knuckle — a clenched bare fist, knuckles forward.
export function BareKnuckleIcon(p: CommunityIconProps) {
  return (
    <Glyph {...p}>
      <path d="M6 10v5a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-5" />
      <path d="M6 10a1.5 1.5 0 0 1 3 0a1.5 1.5 0 0 1 3 0a1.5 1.5 0 0 1 3 0a1.5 1.5 0 0 1 3 0" />
      <path d="M6 12.5H4.5a2 2 0 0 0 0 4H6" />
      <path d="M9 12.5v2" />
      <path d="M12 12.5v2" />
      <path d="M15 12.5v2" />
    </Glyph>
  );
}

// BJJ — a belt tied in a knot, ends hanging (rank belt).
export function BjjIcon(p: CommunityIconProps) {
  return (
    <Glyph {...p}>
      <path d="M3 10h6" />
      <path d="M15 10h6" />
      <rect x="9" y="8" width="6" height="5" rx="1" />
      <path d="M12 8v5" />
      <path d="M10 13l-1 6" />
      <path d="M14 13l1 6" />
    </Glyph>
  );
}

// Wrestling — ear-guard headgear (two cups + head + chin straps).
export function WrestlingIcon(p: CommunityIconProps) {
  return (
    <Glyph {...p}>
      <circle cx="6.5" cy="13" r="2.3" />
      <circle cx="17.5" cy="13" r="2.3" />
      <path d="M7 11C9 5.5 15 5.5 17 11" />
      <path d="M8 14.8C10 17.6 14 17.6 16 14.8" />
    </Glyph>
  );
}

// Judo — the gi (kimono jacket) with crossed collar.
export function JudoIcon(p: CommunityIconProps) {
  return (
    <Glyph {...p}>
      <path d="M8 4L12 9 16 4" />
      <path d="M8 4C5 5 5 8 5 8l1.5 11h11L19 8s0-3-3-4" />
      <path d="M4 13.5l2-.5" />
      <path d="M20 13.5l-2-.5" />
    </Glyph>
  );
}

// Taekwondo — a board split by a breaking strike.
export function TaekwondoIcon(p: CommunityIconProps) {
  return (
    <Glyph {...p}>
      <path d="M3 9l8-1v9l-8 1z" />
      <path d="M21 9l-8-1v9l8 1z" />
      <path d="M12 4v3" />
      <path d="M15 5l-1 2" />
      <path d="M9 5l1 2" />
    </Glyph>
  );
}

// Sambo — the sambovki (sambo wrestling boot).
export function SamboIcon(p: CommunityIconProps) {
  return (
    <Glyph {...p}>
      <path d="M8 3h4v9h6a1 1 0 0 1 1 1v3H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M8.5 6l3 1" />
      <path d="M8.5 8.5l3 1" />
      <path d="M6 15h13" />
    </Glyph>
  );
}

// General Discussion — overlapping speech bubbles.
export function GeneralIcon(p: CommunityIconProps) {
  return (
    <Glyph {...p}>
      <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h9A1.5 1.5 0 0 1 15 5.5v4A1.5 1.5 0 0 1 13.5 11H8l-3 2.5V11H4.5A1.5 1.5 0 0 1 3 9.5z" />
      <path d="M9 13.6v.4A1.5 1.5 0 0 0 10.5 15.5H16l3 2.5V15.5h.5A1.5 1.5 0 0 0 21 14v-4a1.5 1.5 0 0 0-1.5-1.5H17.5" />
    </Glyph>
  );
}

// Industry Discussion — a briefcase (the business of the sport).
export function IndustryIcon(p: CommunityIconProps) {
  return (
    <Glyph {...p}>
      <rect x="3" y="7" width="18" height="12" rx="2" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <path d="M3 12h18" />
      <path d="M11 11h2v2h-2z" />
    </Glyph>
  );
}

// Registry, keyed by community slug (FORUM_CATEGORY_SEED.slug).
export const COMMUNITY_ICONS: Record<string, (p: CommunityIconProps) => React.ReactNode> = {
  mma: MmaIcon,
  boxing: BoxingIcon,
  "muay-thai": MuayThaiIcon,
  kickboxing: KickboxingIcon,
  "bare-knuckle": BareKnuckleIcon,
  bjj: BjjIcon,
  wrestling: WrestlingIcon,
  judo: JudoIcon,
  taekwondo: TaekwondoIcon,
  sambo: SamboIcon,
  general: GeneralIcon,
  industry: IndustryIcon,
};

// Normalise a slug OR a display name ("Muay Thai" → "muay-thai") to a registry
// key, then return the matching community glyph (or null if none).
export function communityIcon(key: string): ((p: CommunityIconProps) => React.ReactNode) | null {
  const slug = key.trim().toLowerCase().replace(/\s+/g, "-");
  return COMMUNITY_ICONS[slug] ?? null;
}
