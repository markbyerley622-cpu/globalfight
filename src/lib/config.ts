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

/**
 * Is this deployment serving the address we publish?
 *
 * The audit found canonical URLs, OG images, the robots `Host` and the sitemap
 * all pointing at `globalfight.onrender.com`, which returns 503 — search engines
 * were told a dead host was authoritative for the whole site. The cause is the
 * fallback chain above doing its job: with NEXT_PUBLIC_SITE_URL unset, SITE.url
 * resolves to whatever RENDER_EXTERNAL_URL happens to be, and a service slug is
 * not a product address.
 *
 * The chain must stay (a wrong canonical beats a dead build), so instead we
 * detect the case and refuse to be indexed under it. A deployment is canonical
 * only when the origin was stated EXPLICITLY: an operator naming the domain is
 * exactly the signal that this is the real one.
 *
 * Set NEXT_PUBLIC_SITE_URL to the production domain and this returns true.
 */
export function isCanonicalHost(): boolean {
  return parseOrigin(process.env.NEXT_PUBLIC_SITE_URL) !== null;
}

export const SITE = {
  name: "Combat Reviews",
  tagline: "The Registry of Combat Sports",
  pitch: "Every fighter, gym, promoter and official — one source-backed network.",
  description:
    "The combat-sports ecosystem registry — fighters, gyms, coaches, promoters, federations, commissions, officials, venues and events across boxing, MMA, Muay Thai and more. Source-backed rankings, records, schedules, results and community.",
  url: resolveSiteUrl(),
} as const;

// ── Sponsors / partners ──────────────────────────────────────────────────
//
// Moved to src/lib/sponsors.ts: one source of truth, an ENFORCED date window,
// and nullable hrefs so a partner without a confirmed destination renders as a
// mark rather than a dead link.
//
// The bar for adding one has not moved: every field, including an agreement
// reference and an approving owner. Displaying a company's mark and calling it
// a partner without permission is a false representation and a trademark
// problem, regardless of intent. If you cannot fill those fields in, you do not
// have a sponsor.

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
// The bottom bar carries the five product pillars (Events · Leaderboard ·
// Following · Location · Profile). Everything that is NOT a pillar — Home, the
// community surfaces, the registry — is reachable here, so no surface lost a
// route when the tab bar was reduced to the pillars.
export const PRIMARY_NAV: NavItem[] = [
  { label: "Home", href: "/" },
  // The one surface that is about the reader rather than the next card — and
  // the only reason to open the app on a day with no fights, so it sits second
  // rather than buried under Explore.
  { label: "Today", href: "/today" },
  { label: "Location", href: "/map" },
  {
    label: "Explore",
    href: "/explore",
    children: [
      { label: "Fighters", href: "/fighters" },
      { label: "Gyms", href: "/gyms" },
      { label: "Schedule", href: "/schedule" },
      { label: "Results", href: "/results" },
      { label: "Registry", href: "/registry" },
    ],
  },
  {
    label: "Community",
    href: "/community",
    children: [
      { label: "Communities", href: "/community" },
      { label: "Forums", href: "/forums" },
      { label: "News", href: "/news" },
      { label: "Podcasts", href: "/podcasts" },
    ],
  },
  // Watch is reachable from the primary nav rather than the pillar bar: the
  // five pillars are fixed by design and a bottom bar that grows a sixth tab
  // stops being a pillar bar. /clips had no entry point at all before this.
  { label: "Watch", href: "/clips" },
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

// ── Locales ────────────────────────────────────────────────────────────────
//  `released` is the difference between what the ARCHITECTURE supports and what
//  the product PROMISES. Every locale below still works end to end — the cookie,
//  the dictionary lookup, the RTL flag, the server translator — but only released
//  ones appear in the switcher.
//
//  Why: an audit (`npm run audit:i18n`) measured ~10.5% string coverage against
//  nine advertised languages. Picking Japanese changed the navigation and left the
//  rest of the page in English. Arabic was worse than that — it flipped the entire
//  layout to RTL while ninety per cent of the text stayed English, which reads as
//  broken rather than partial.
//
//  Two complete languages are worth more than nine incomplete ones. Releasing a
//  locale is a one-word change here, and the honest gate is: run the audit, and
//  only flip it when that locale's coverage is actually 100%.
export const LOCALES = [
  { code: "en", name: "English", native: "English", rtl: false, released: true },
  { code: "es", name: "Spanish", native: "Español", rtl: false, released: true },
  { code: "fr", name: "French", native: "Français", rtl: false, released: false },
  { code: "de", name: "German", native: "Deutsch", rtl: false, released: false },
  { code: "pt", name: "Portuguese", native: "Português", rtl: false, released: false },
  { code: "it", name: "Italian", native: "Italiano", rtl: false, released: false },
  { code: "ar", name: "Arabic", native: "العربية", rtl: true, released: false },
  { code: "ja", name: "Japanese", native: "日本語", rtl: false, released: false },
  { code: "zh", name: "Chinese", native: "中文", rtl: false, released: false },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];
export const DEFAULT_LOCALE: Locale = "en";

/**
 * The locales a user may actually choose.
 *
 * Everything that renders a language CHOICE reads this, never LOCALES — that is
 * what stops the switcher advertising a language the dictionary cannot deliver.
 * Code that VALIDATES a stored preference still reads LOCALES, so someone who
 * already picked French keeps working rather than being silently reset.
 */
export const RELEASED_LOCALES = LOCALES.filter((l) => l.released);

export const isReleasedLocale = (code: string): boolean =>
  RELEASED_LOCALES.some((l) => l.code === code);

export const BODY_LABELS: Record<string, { full: string; color: string }> = {
  WBA: { full: "World Boxing Association", color: "text-gold-400" },
  WBC: { full: "World Boxing Council", color: "text-gold-400" },
  IBF: { full: "International Boxing Federation", color: "text-gold-400" },
  WBO: { full: "World Boxing Organization", color: "text-gold-400" },
  RING: { full: "The Ring Magazine", color: "text-gold-400" },
};
