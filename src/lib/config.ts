const DEFAULT_SITE_URL = "https://combat-register.vercel.app";

function parseOrigin(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * The site's public origin, in order of preference:
 *
 *   1. NEXT_PUBLIC_SITE_URL — the explicit override, and the only one of the
 *      three that reaches client bundles (Next inlines NEXT_PUBLIC_* only).
 *      Every SITE.url consumer is server-side today, but a client component
 *      reading it would see ONLY this one — keep it set in production.
 *   2. RENDER_EXTERNAL_URL — injected by Render with the service's real origin.
 *      Removes the hand-pasted step that this fallback chain exists to survive.
 *   3. DEFAULT_SITE_URL.
 *
 * Values are validated rather than trusted: SITE.url is fed straight to
 * `new URL()` for metadataBase in layout.tsx, so an unparseable value throws
 * during `next build`'s page-data collection and surfaces only as "Failed to
 * collect page data for /account" — naming neither the variable nor the value.
 * A copy-pasted placeholder ("https://<your-app>.onrender.com") lands here and
 * once cost a deploy. Bad input degrades to the next source with a named
 * warning: wrong canonical links on one deploy beat a dead build.
 */
export function resolveSiteUrl(fallback: string = DEFAULT_SITE_URL): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const explicit = parseOrigin(raw);
  if (explicit) return explicit;

  if (raw) {
    console.warn(
      `[config] NEXT_PUBLIC_SITE_URL is not a valid http(s) origin: ${JSON.stringify(raw)}. ` +
        `Ignoring it. Set it to your real origin, scheme included.`,
    );
  }
  return parseOrigin(process.env.RENDER_EXTERNAL_URL) ?? fallback;
}

export const SITE = {
  name: "Combat Register",
  tagline: "The Registry of Combat Sports",
  pitch: "Every fighter, gym, promoter and official — one source-backed network.",
  description:
    "The combat-sports ecosystem registry — fighters, gyms, coaches, promoters, federations, commissions, officials, venues and events across boxing, MMA, Muay Thai and more. Source-backed rankings, records, schedules, results and community.",
  url: resolveSiteUrl(),
} as const;

// ── Sponsors / partners — EMPTY BY DESIGN ────────────────────────────────
//
// These lists used to display BOX iQ, Kong Fight Tape and BATL Promotions as
// sponsors, and DAZN, ESPN+, TNT Sports, Sky Sports, Main Event and Prime Video
// as broadcast partners — every one of them with `href: "#"`.
//
// There is no agreement, contract, or permission for any of them anywhere in this
// repository. Displaying a company's mark and calling it a partner is a false
// representation and a trademark problem, regardless of intent. They are removed
// rather than hidden.
//
// To add a REAL sponsor, every field in SponsorEntry must be supplied — including
// an agreement reference and an approval owner. If you cannot fill those in, you do
// not have a sponsor.
export interface SponsorEntry {
  /** Registered legal name of the counterparty. */
  legalName: string;
  /** Display name, as approved in the agreement. */
  name: string;
  /** Path to the mark, in the form the rights-holder approved. */
  src: string;
  /** Real destination. Never "#". */
  href: string;
  relationship: "sponsor" | "partner" | "broadcaster" | "data-provider";
  /** Reference to the signed agreement (contract id / filename / ticket). */
  agreementRef: string;
  startDate: string;
  endDate: string;
  /** Person accountable for the claim being true. */
  approvedBy: string;
  boxed?: boolean;
  small?: boolean;
  textOnly?: boolean;
}

// Official partners — owner-supplied marks (michael@avonstowe.com). The owner
// asserts these are real, permissioned partners and is the accountable approver.
// TODO(owner): replace each `href` with the partner's real destination URL.
export const SPONSORS: readonly SponsorEntry[] = [
  {
    legalName: "BOX iQ", name: "BOX iQ",
    src: "/brand/partners/box-iq.png", href: "https://www.boxiq.me",
    relationship: "partner", agreementRef: "owner-supplied-2026-07-15",
    startDate: "2026-07-15", endDate: "2027-07-15", approvedBy: "michael@avonstowe.com",
  },
  {
    legalName: "Kong Fight Tape", name: "Kong Fight Tape",
    src: "/brand/partners/kong-fight-tape.avif", href: "/",
    relationship: "partner", agreementRef: "owner-supplied-2026-07-15",
    startDate: "2026-07-15", endDate: "2027-07-15", approvedBy: "michael@avonstowe.com",
  },
  {
    legalName: "BATL Promotions", name: "BATL Promotions",
    src: "/brand/partners/batl-promotions.avif", href: "https://batlboxing.com",
    relationship: "partner", agreementRef: "owner-supplied-2026-07-15",
    startDate: "2026-07-15", endDate: "2027-07-15", approvedBy: "michael@avonstowe.com",
  },
  {
    legalName: "Combat Profile", name: "Combat Profile",
    src: "/brand/partners/combat-profile.png", href: "/",
    relationship: "partner", agreementRef: "owner-supplied-2026-07-15",
    startDate: "2026-07-15", endDate: "2027-07-15", approvedBy: "michael@avonstowe.com",
  },
];
export const PARTNERS: readonly SponsorEntry[] = [];

// A nav entry is either a direct link or a group with `children` rendered as a
// dropdown (desktop) / accordion (mobile). Groups have no destination of their
// own — the `href` is only used as a stable key.
// `accent` renders the entry as a standout brand-red pill (used for Combat).
export type NavItem = { label: string; href: string; children?: NavItem[]; accent?: boolean };

// Order: the Combat Feed is the landing experience (href "/"), followed by the
// classic Home overview and the rest of the registry sections, with the Combat
// pill last. Desktop and mobile both render from this single source.
// Simplified to five top-level destinations. Feed and Community are the two
// social surfaces; every registry/data page tucks under Explore (a dropdown), so
// nothing is lost — just fewer top-level choices. Account/sign-in is rendered
// separately in the navbar's right actions, so it isn't listed here.
// Rankings / P4P / Champions are REMOVED from navigation for launch.
//
// Every ranking row in the database was scraped from a promotion's own ranking
// table (UFC, BKFC, PFL, ONE, FightersRec, FloGrappling). A ranking table is an
// editorial compilation, not a fact — it is the classic UK/EU database-right and
// copyright target. Until a licensed source exists, the data is not displayed and
// the routes are disabled server-side (RANKINGS_ENABLED, default false).
//
// Hiding the nav entry is NOT the control — the routes enforce it. This is here so
// we do not advertise a page that returns "unavailable". Restore these entries only
// when a licensed source is in place.
export const PRIMARY_NAV: NavItem[] = [
  {
    label: "Explore",
    href: "/explore",
    children: [
      { label: "Fighters", href: "/fighters" },
      { label: "Schedule", href: "/schedule" },
      { label: "Results", href: "/results" },
      { label: "Registry", href: "/registry" },
    ],
  },
];

// Every href here MUST resolve. `/about` and `/data` were linked and did not
// exist — two 404s in the shipped footer, advertising exactly the gap (a missing
// privacy notice) that they implied was covered. A dead-link check runs in CI.
export const FOOTER_NAV: { title: string; items: NavItem[] }[] = [
  {
    title: "Fights",
    items: [
      { label: "Schedule", href: "/schedule" },
      { label: "Results", href: "/results" },
    ],
  },
  {
    title: "Registry",
    items: [
      { label: "Fighters", href: "/fighters" },
      { label: "Gyms & Coaches", href: "/registry?type=gym" },
      { label: "Promoters", href: "/registry?type=promotion" },
      { label: "Federations", href: "/registry?type=federation" },
      { label: "Commissions", href: "/registry?type=commission" },
    ],
  },
  {
    title: "Community",
    items: [
      { label: "Feed", href: "/" },
      { label: "News", href: "/news" },
      { label: "Communities", href: "/community" },
      { label: "Forums", href: "/forums" },
      { label: "Join / Sign up", href: "/account" },
    ],
  },
  {
    title: "Legal",
    items: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "Cookies", href: "/cookies" },
      { label: "Community Guidelines", href: "/community-guidelines" },
      { label: "Copyright / Takedown", href: "/copyright" },
      { label: "Data Sources", href: "/data-sources" },
    ],
  },
];

export const LOCALES = [
  { code: "en", name: "English", native: "English", rtl: false },
  { code: "es", name: "Spanish", native: "Español", rtl: false },
  { code: "fr", name: "French", native: "Français", rtl: false },
  { code: "de", name: "German", native: "Deutsch", rtl: false },
  { code: "pt", name: "Portuguese", native: "Português", rtl: false },
  { code: "it", name: "Italian", native: "Italiano", rtl: false },
  { code: "ar", name: "Arabic", native: "العربية", rtl: true },
  { code: "ja", name: "Japanese", native: "日本語", rtl: false },
  { code: "zh", name: "Chinese", native: "中文", rtl: false },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];
export const DEFAULT_LOCALE: Locale = "en";

export const BODY_LABELS: Record<string, { full: string; color: string }> = {
  WBA: { full: "World Boxing Association", color: "text-gold-400" },
  WBC: { full: "World Boxing Council", color: "text-gold-400" },
  IBF: { full: "International Boxing Federation", color: "text-gold-400" },
  WBO: { full: "World Boxing Organization", color: "text-gold-400" },
  RING: { full: "The Ring Magazine", color: "text-gold-400" },
};
