/**
 * Every word on the public landing page, in one place.
 *
 * Copy lives apart from presentation for two reasons that both bite in practice:
 * a claim is a legal artefact as much as a design one, so it needs to be
 * reviewable without reading JSX; and the tests assert against these constants
 * rather than against strings retyped inside an expectation, so a reworded
 * headline cannot quietly pass a test that no longer checks anything.
 *
 * The rule every line here obeys: **the product must already do it.** Nothing
 * below describes a feature that is not live on this deployment today. Where the
 * product does something narrower than the obvious marketing phrase, the narrower
 * phrase wins — see NAV, where "Community" points at the forums that exist rather
 * than at a "social network" that does not.
 */

import { REGISTRY_ROLE_DEFS } from "@/lib/roles";

/* ── Routes ─────────────────────────────────────────────────────────────────
   Named once so a CTA cannot drift from the route it claims to open. `?next=`
   is honoured by /account, which sends the new member back here after signup. */
export const ROUTES = {
  signup: "/account?next=/events",
  signin: "/account?mode=signin&next=/events",
  events: "/events",
  fighters: "/fighters",
  results: "/results",
  community: "/community",
  leaderboard: "/leaderboard",
  following: "/following",
  map: "/map",
  gyms: "/gyms",
  news: "/news",
  dataSources: "/data-sources",
  copyright: "/copyright",
  privacy: "/privacy",
  terms: "/terms",
} as const;

export const CTA = {
  primary: "Create your account",
  primaryShort: "Create account",
  secondary: "Explore events",
  secondaryLong: "Explore upcoming events",
  signin: "Sign in",
  profile: "Create your profile",
} as const;

/* ── 1. Navigation ─────────────────────────────────────────────────────────
   Four destinations, not eleven. Every one is a live route on this deployment;
   the registry's deeper surfaces (gyms, promoters, federations) are reachable
   from inside the product, which is where someone looking for them already is. */
export const NAV: { label: string; href: string }[] = [
  { label: "Events", href: ROUTES.events },
  { label: "Fighters", href: ROUTES.fighters },
  { label: "Results", href: ROUTES.results },
  { label: "Community", href: ROUTES.community },
];

/* ── 2. Hero ───────────────────────────────────────────────────────────────── */
export const HERO = {
  eyebrow: "The home of combat sports",
  headline: ["Every fight.", "Every fighter.", "One place."],
  support:
    "Discover upcoming cards, follow the people who matter, make your picks and stay connected from announcement to result.",
  micro: "Free to join. Built for fans and the fight industry.",
  sports: "MMA · Boxing · Muay Thai · Kickboxing · Bare Knuckle · Grappling · Wrestling · Judo",
} as const;

/* ── 3. The scroll narrative ────────────────────────────────────────────────
   One card, followed from announcement to result. Four stages, four verbs:
   discover it, understand it, act on it, come back for the outcome. */
export type StageId = "discover" | "card" | "pick" | "follow";

export interface Stage {
  id: StageId;
  label: string;
  headline: string;
  support: string;
  /** Announced to a screen reader in place of the visual. */
  visualLabel: string;
}

export const STORY_HEADING = "One fight, followed from announcement to result";

export const STAGES: Stage[] = [
  {
    id: "discover",
    label: "01 — Discover",
    headline: "Know what is coming.",
    support: "Events across every combat sport, organised by date, promotion and location.",
    visualLabel:
      "Scattered fight announcements resolving into a single Combat Reviews event card, with sport, promotion and location filters.",
  },
  {
    id: "card",
    label: "02 — The full card",
    headline: "See the whole fight night.",
    support:
      "Bouts, records, timings, venue, broadcast and tickets — connected to one event.",
    visualLabel:
      "The event card opening into a full fight card: main event, main card and prelims, with fighter records, venue, broadcast and countdown.",
  },
  {
    id: "pick",
    label: "03 — Make your call",
    headline: "Pick. Discuss. Prove it.",
    support:
      "Call each fight, join the discussion and build a record based on correct predictions.",
    visualLabel:
      "One bout opened into red and blue corners with a prediction control, the crowd's split, the bout's discussion room and the points a correct call is worth.",
  },
  {
    id: "follow",
    label: "04 — Follow the story",
    headline: "From announcement to result.",
    support:
      "Follow fighters and events, get fight-week updates and come back for the official result.",
    visualLabel:
      "The same event moving through followed, fight-week reminder, related coverage, final result, updated record and leaderboard movement.",
  },
];

/** The product's own words for what a pick is. Not a wager. */
export const SKILL_NOT_BETTING = "Skill, not betting.";

/* ── 4. Product ecosystem ───────────────────────────────────────────────────── */
export const ECOSYSTEM = {
  headline: "More than the event.",
  support: "Every record, venue, result and conversation stays connected.",
} as const;

export type WindowId = "fighters" | "results" | "location" | "coverage";

export interface EcosystemWindow {
  id: WindowId;
  copy: string;
  href: string;
  linkLabel: string;
}

export const WINDOWS: EcosystemWindow[] = [
  { id: "fighters", copy: "Records that lead somewhere.", href: ROUTES.fighters, linkLabel: "Browse fighters" },
  { id: "results", copy: "The record book, updated.", href: ROUTES.results, linkLabel: "See results" },
  { id: "location", copy: "Find the fight world around you.", href: ROUTES.map, linkLabel: "Open the map" },
  { id: "coverage", copy: "Coverage attached to the card.", href: ROUTES.news, linkLabel: "Read the news" },
];

/* ── 5. Personalisation and identity ────────────────────────────────────────── */
export const PERSONAL = {
  headline: "Your fight world, personalised.",
  fan: {
    title: "For fans",
    copy: "Follow what matters. Build a record that is yours.",
  },
  industry: {
    title: "For the industry",
    copy: "Claim your place in the registry.",
  },
} as const;

/**
 * The roles shown in the identity selector.
 *
 * DERIVED from `REGISTRY_ROLE_DEFS` — the same list the sign-up form renders and
 * the same allow-list the API validates against — rather than retyped here. A
 * hand-written copy would eventually advertise a role the form does not offer,
 * which is a promise the product breaks at the first click.
 */
export const ROLE_LABELS: readonly string[] = REGISTRY_ROLE_DEFS.map((r) => r.label);

/* ── 6. Trust ───────────────────────────────────────────────────────────────
   Deliberately modest. No accuracy guarantee, no official affiliation, no
   certification marks — each of those is a claim we would have to defend. */
export const TRUST = {
  headline: "Built on the record.",
  principles: [
    {
      id: "sourced",
      title: "Source-backed",
      copy: "Profiles, events and results connect back to public records and published sources.",
    },
    {
      id: "independent",
      title: "Independent",
      copy: "Combat Reviews is not controlled by a promotion or sanctioning body.",
    },
    {
      id: "open",
      title: "Open registry",
      copy: "Professionals can claim profiles. Anyone can submit a correction.",
    },
  ],
  links: [
    { label: "Data sources", href: ROUTES.dataSources },
    { label: "Corrections & copyright", href: ROUTES.copyright },
    { label: "Privacy", href: ROUTES.privacy },
    { label: "Terms", href: ROUTES.terms },
  ],
} as const;

/* ── 7. Final conversion ────────────────────────────────────────────────────── */
export const FINAL = {
  headline: "The fight world is already here.",
  support: "Create your account. Follow the fighters. Call the fights. Build your record.",
  reassurance: "Free to join · No betting · Control what you follow",
} as const;

/* ── Metadata ───────────────────────────────────────────────────────────────── */
export const META = {
  title: "Combat Reviews — Every Fight. Every Fighter. One Place.",
  description:
    "Discover combat-sports events, full fight cards, fighter records, predictions, results and coverage across MMA, boxing, Muay Thai and more.",
} as const;
