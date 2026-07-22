// ════════════════════════════════════════════════════════════════════════════
//  Sponsors & partners — ONE source of truth.
//
//  Why this stays in CODE rather than becoming a database table an admin edits:
//  a partner mark is a contractual and legal asset. Who approved it, under what
//  agreement, and from when to when has to be reviewable and reversible, and
//  git gives that for free — every change is attributable to a commit. A CMS
//  form gives an audit trail nobody reads and a rollback nobody has. The admin
//  surface therefore SHOWS state (live / expiring / not yet linked); it does
//  not edit it. See /admin/sponsors.
//
//  Two rules that were previously unenforced:
//
//   1. `href` is NULLABLE and null means "no agreed destination yet". Two
//      partners were pointing at "/" — the homepage — which renders as a link,
//      looks like a partner destination, and goes nowhere. A logo with no
//      destination now renders as a plain image, not a dead link. We never
//      invent a URL for a partner.
//
//   2. `startDate`/`endDate` are ENFORCED. They existed on the old type and
//      nothing read them, so an expired agreement would have kept rendering
//      indefinitely. `activeSponsors()` is the only accessor, and it filters.
// ════════════════════════════════════════════════════════════════════════════

export type SponsorCategory = "equipment" | "promotion" | "media" | "technology" | "other";

export interface Sponsor {
  /** Stable key. Never reused, never renamed — it is what analytics groups on. */
  id: string;
  slug: string;
  name: string;
  /** The entity on the agreement, when it differs from the display name. */
  legalName: string;
  logo: string;
  /** Destination. `null` = agreed partner, no confirmed URL yet → not a link. */
  href: string | null;
  description?: string;
  category: SponsorCategory;
  /** Lower sorts first. Ties fall back to declaration order. */
  priority: number;
  /** Manual kill switch, independent of the date window. */
  active: boolean;
  /** ISO dates. Enforced by activeSponsors(). */
  startDate: string;
  endDate: string;
  agreementRef: string;
  approvedBy: string;
  /** Featured partners may be given prominence by a surface that supports it. */
  featured?: boolean;
  /** Per-mark optical correction. Some logos have huge internal padding and
   *  render visually tiny at a shared height; this belongs to the DATA, not to
   *  an `if (src.includes("box-iq"))` inside a component. */
  logoScale?: number;
  socials?: { instagram?: string; x?: string; youtube?: string };
  /** Set only when a partner has supplied one. Prefer over `href` when present. */
  affiliateUrl?: string;
  campaignUrl?: string;
}

/**
 * Owner-supplied marks (michael@avonstowe.com). The owner asserts these are
 * real, permissioned partners and is the accountable approver.
 *
 * `href: null` on Kong Fight Tape and Combat Profile is deliberate and correct:
 * no destination has been confirmed for them. They were previously linked to
 * "/", which is a dead link wearing a partner's name.
 */
export const SPONSORS: readonly Sponsor[] = [
  {
    id: "box-iq",
    slug: "box-iq",
    name: "BOX iQ",
    legalName: "BOX iQ",
    logo: "/brand/partners/box-iq.png",
    href: "https://www.boxiq.me",
    category: "technology",
    description: "Boxing performance tracking.",
    priority: 10,
    active: true,
    startDate: "2026-07-15",
    endDate: "2027-07-15",
    agreementRef: "owner-supplied-2026-07-15",
    approvedBy: "michael@avonstowe.com",
    logoScale: 1.4,
  },
  {
    id: "batl-promotions",
    slug: "batl-promotions",
    name: "BATL Promotions",
    legalName: "BATL Promotions",
    logo: "/brand/partners/batl-promotions.avif",
    href: "https://batlboxing.com",
    category: "promotion",
    description: "Boxing promotion.",
    priority: 20,
    active: true,
    startDate: "2026-07-15",
    endDate: "2027-07-15",
    agreementRef: "owner-supplied-2026-07-15",
    approvedBy: "michael@avonstowe.com",
  },
  {
    id: "kong-fight-tape",
    slug: "kong-fight-tape",
    name: "Kong Fight Tape",
    legalName: "Kong Fight Tape",
    logo: "/brand/partners/kong-fight-tape.avif",
    href: null, // no confirmed destination — renders unlinked, never guessed
    category: "equipment",
    priority: 30,
    active: true,
    startDate: "2026-07-15",
    endDate: "2027-07-15",
    agreementRef: "owner-supplied-2026-07-15",
    approvedBy: "michael@avonstowe.com",
  },
  {
    id: "combat-profile",
    slug: "combat-profile",
    name: "Combat Profile",
    legalName: "Combat Profile",
    logo: "/brand/partners/combat-profile.png",
    href: null, // no confirmed destination — renders unlinked, never guessed
    category: "media",
    priority: 40,
    active: true,
    startDate: "2026-07-15",
    endDate: "2027-07-15",
    agreementRef: "owner-supplied-2026-07-15",
    approvedBy: "michael@avonstowe.com",
  },
];

/** The destination to actually use: affiliate and campaign links take priority
 *  over the plain site when a partner has supplied one. */
export function sponsorHref(s: Sponsor): string | null {
  return s.campaignUrl ?? s.affiliateUrl ?? s.href ?? null;
}

export function isLive(s: Sponsor, now: Date = new Date()): boolean {
  if (!s.active) return false;
  const start = Date.parse(s.startDate);
  const end = Date.parse(s.endDate);
  const t = now.getTime();
  // A malformed date must not silently hide a live partner, nor silently keep
  // an expired one — treat it as out of window and let the admin page flag it.
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return t >= start && t <= end;
}

/**
 * THE accessor. Every surface uses this — nothing imports SPONSORS directly
 * except the admin status page, which exists to show what is filtered out.
 */
export function activeSponsors(now: Date = new Date()): Sponsor[] {
  return SPONSORS.filter((s) => isLive(s, now)).sort((a, b) => a.priority - b.priority);
}

/** Days until an agreement lapses. Negative once expired. */
export function daysUntilExpiry(s: Sponsor, now: Date = new Date()): number {
  const end = Date.parse(s.endDate);
  if (Number.isNaN(end)) return NaN;
  return Math.round((end - now.getTime()) / 86_400_000);
}
