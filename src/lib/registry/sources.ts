// ════════════════════════════════════════════════════════════════════════════
//  THE PROVIDER VOCABULARY — one spelling of every source id, everywhere.
//
//  ── Why a constant and not just a string ─────────────────────────────────
//  `FighterExternalId` is keyed on `(source, externalId)`, and identity
//  resolution's strongest rung is a lookup on that pair. Which means a source
//  string is not a label — it is half of a primary key.
//
//  Two connectors writing "ufc" and "ufc-stats" for the same provider do not
//  produce a duplicate row; they produce a MISS. The fighter resolves by name
//  instead, and the registry quietly gains a second entry for someone it already
//  had. That is the failure this file exists to make impossible, and it costs
//  one import to avoid.
//
//  ── Tiers ────────────────────────────────────────────────────────────────
//  The same four tiers the reconciler uses (lib/registry/reconcile). Declared
//  here per source so a connector cannot invent its own standing: a provider's
//  authority is a property of the provider, not of the code that reads it.
// ════════════════════════════════════════════════════════════════════════════

import type { Tier } from "./reconcile";

export interface ProviderSpec {
  /** The id written into FighterExternalId.source and ProviderCheckpoint.provider. */
  id: string;
  label: string;
  tier: Tier;
  /**
   * Cleared to ingest? Default false — opt-in per source, and a commercial
   * decision rather than an engineering one for anything in AGGREGATOR.
   */
  licensed: boolean;
  /** What this provider is authoritative ABOUT. Empty = supporting evidence only. */
  authoritativeFor: ("events" | "bouts" | "results" | "champions" | "rankings" | "fighters")[];
  note?: string;
}

/**
 * Every source the registry recognises.
 *
 * Adding a promotion is an entry here plus a connector — never a new table, a
 * new pipeline or a new identity path.
 */
export const PROVIDERS: ProviderSpec[] = [
  // ── Tier 1: the organisation speaking about itself ──────────────────────
  {
    id: "ufc-stats",
    label: "UFC Stats",
    tier: "OFFICIAL",
    licensed: true,
    authoritativeFor: ["bouts", "results"],
    // Deliberately NOT records. UFC Stats publishes per-bout and per-round
    // detail; the Record Book publishes career records. Reading one for the
    // other is how a fighter's record starts disagreeing with the sum of their
    // bouts, so they stay two providers with two responsibilities.
    note: "Bout + round detail: judges, method, knockdowns, strikes, takedowns.",
  },
  {
    id: "ufc-recordbook",
    label: "UFC Record Book",
    tier: "OFFICIAL",
    licensed: true,
    authoritativeFor: ["fighters"],
    note: "Career records only. Never bout detail — see ufc-stats.",
  },
  {
    id: "ufc-mma",
    label: "UFC.com Official Rankings",
    tier: "OFFICIAL",
    licensed: true,
    authoritativeFor: ["rankings", "champions"],
  },
  {
    id: "one",
    label: "ONE Championship",
    tier: "OFFICIAL",
    licensed: true,
    authoritativeFor: ["events", "bouts", "results", "champions"],
    // Measured, not assumed: `npm run audit:quality` reports 518 ONE events with
    // 108 carrying no bouts at all — the single largest coverage gap in the
    // database. The syndication feed gives metadata; the Live Results pages give
    // the card, the finishes, the rounds and the times.
    note: "Biggest measured gap. Metadata feed ≠ results; Live Results pages carry the card.",
  },
  { id: "bkfc", label: "Bare Knuckle FC", tier: "OFFICIAL", licensed: true, authoritativeFor: ["events", "bouts", "results", "champions"] },
  { id: "glory", label: "GLORY Kickboxing", tier: "OFFICIAL", licensed: true, authoritativeFor: ["events", "bouts", "results", "champions"] },
  { id: "k1", label: "K-1", tier: "OFFICIAL", licensed: false, authoritativeFor: ["events", "bouts", "results"] },
  { id: "ifma", label: "IFMA (Muay Thai)", tier: "OFFICIAL", licensed: false, authoritativeFor: ["events", "results"] },
  { id: "wako", label: "WAKO (Kickboxing)", tier: "OFFICIAL", licensed: false, authoritativeFor: ["events", "results"] },
  { id: "fias", label: "FIAS (Sambo)", tier: "OFFICIAL", licensed: false, authoritativeFor: ["events", "results"] },
  { id: "wt", label: "World Taekwondo", tier: "OFFICIAL", licensed: false, authoritativeFor: ["events", "results"] },
  { id: "wba", label: "WBA", tier: "OFFICIAL", licensed: true, authoritativeFor: ["rankings", "champions"] },

  // ── Tier 2: independent, structured, never authoritative over an org ────
  {
    id: "mmaapi",
    label: "mmaapi.dev",
    tier: "ENCYCLOPAEDIC",
    licensed: false,
    // Deliberately empty. Used for VERIFICATION and for external ids/aliases —
    // corroborating what an official source said and filling identity gaps — not
    // as the truth about a result. A second opinion is worth more than a second
    // authority.
    authoritativeFor: [],
    note: "Verification, ids and aliases. Not a source of record.",
  },
  {
    id: "wikidata",
    label: "Wikidata",
    tier: "ENCYCLOPAEDIC",
    licensed: true,
    authoritativeFor: [],
    note: "CC0. Structured — prefer over HTML wherever it publishes the field.",
  },
  {
    id: "wikipedia",
    label: "Wikipedia",
    tier: "ENCYCLOPAEDIC",
    licensed: true,
    // Honest exception to "encyclopaedic is never authoritative": for BKFC, ONE
    // and kickboxing it is currently the ONLY machine-readable source of bout
    // results, because those promotions render theirs client-side. Demoting it
    // for rankings is right; removing it globally would delete several sports.
    authoritativeFor: ["results"],
    note: "CC BY-SA. The only results source for BKFC/ONE/kickboxing today.",
  },
  { id: "espn", label: "ESPN", tier: "ENCYCLOPAEDIC", licensed: true, authoritativeFor: [] },

  // ── Tier 3: licensed aggregators. None wired — a commercial decision. ───
  { id: "sherdog", label: "Sherdog", tier: "AGGREGATOR", licensed: false, authoritativeFor: [], note: "Needs a licence decision." },
  { id: "tapology", label: "Tapology", tier: "AGGREGATOR", licensed: false, authoritativeFor: [], note: "Needs a licence decision." },
  {
    id: "boxrec",
    label: "BoxRec",
    tier: "AGGREGATOR",
    licensed: false,
    authoritativeFor: [],
    // Not merely unlicensed — BLOCKED in code (lib/rankings/connectors
    // INGEST_BLOCKLIST), checked at ingest even if this flag were flipped.
    note: "BLOCKED in code. Terms forbid ingestion.",
  },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

export const providerSpec = (id: string): ProviderSpec | null => BY_ID.get(id) ?? null;

/** Tier of a source id. Unknown sources are INTERNAL — the weakest, never a guess upward. */
export const tierOfProvider = (id: string): Tier => BY_ID.get(id)?.tier ?? "INTERNAL";

/** Is this source cleared to ingest? Unknown → no. Fail closed. */
export const isLicensed = (id: string): boolean => BY_ID.get(id)?.licensed ?? false;

/**
 * Does this provider get to DECIDE this kind of fact, or only corroborate it?
 *
 * The reconciler already orders by tier; this is the narrower question of scope.
 * mmaapi.dev is a good, current source and still should not overturn a
 * promotion's own result — it verifies, it does not rule.
 */
export const isAuthoritativeFor = (id: string, kind: ProviderSpec["authoritativeFor"][number]): boolean =>
  BY_ID.get(id)?.authoritativeFor.includes(kind) ?? false;

/** The source ids valid in `FighterExternalId.source`. */
export const EXTERNAL_ID_SOURCES = PROVIDERS.map((p) => p.id);
