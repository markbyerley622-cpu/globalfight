// ════════════════════════════════════════════════════════════════════════
//  Ranking Intelligence Engine — Layer 1 (connector) + Layer 2 (normalized
//  contract). This is the DURABLE INTERFACE every source parser plugs into; it
//  deliberately contains NO parser logic and NO business logic — a connector is
//  added by implementing `RankingConnector`, never by editing the engine.
//
//  IMPORTANT — this is the engine's contract + foundation, not a live ingest.
//  Rankings are currently gated OFF (env RANKINGS_ENABLED, default false) because
//  the prior data could not be traced to a LICENSED source and was withdrawn.
//  Wiring a connector re-enables a feature that was disabled for compliance — an
//  owner decision. Start with official sanctioning bodies (see sources.ts tiers);
//  do NOT ingest sources whose terms forbid it (e.g. BoxRec). See
//  docs/RANKING_ENGINE.md.
// ════════════════════════════════════════════════════════════════════════

export type Gender = "male" | "female";
export type RankingKind = "professional" | "amateur" | "youth";

/** Layer 2 — the one normalized shape every source is converted into. */
export interface RankingEntry {
  /** Fighter display name as published by the source (identity resolution happens later). */
  name: string;
  /** e.g. "Heavyweight", "Super Lightweight" — normalized weight-class label. */
  weightClass: string;
  /** 1-based position. 0 = champion/unranked-holder where a body lists a titlist separately. */
  rank: number;
  gender: Gender;
  kind: RankingKind;
  /** ISO-3166 alpha-2 where the source gives a nationality, else null. */
  countryCode: string | null;
  /** The sanctioning body / list this rank belongs to, e.g. "WBA", "EBU", "British Boxing". */
  organisation: string;
  /** "boxing" | "mma" | … — the engine is sport-agnostic; boxing is first. */
  sport: string;
  /** When the SOURCE says this ranking is effective (its publication date), not fetch time. */
  effectiveDate: string; // ISO date
  /** Canonical URL the row was read from (provenance). */
  sourceUrl: string;
}

/** Trust tier → a numeric confidence, surfaced in the UI as Verified/Official/etc. */
export const TRUST = {
  official: 100,   // sanctioning body / commission publishing its own ranking
  commission: 95,
  promotion: 90,
  federation: 88,  // national federation official list
  media: 80,       // reputable boxing media
  community: 60,
  unknown: 40,
} as const;
export type TrustLevel = keyof typeof TRUST;

/** Layer 1 — a source connector. One per source; returns normalized entries only. */
export interface RankingConnector {
  /** Stable id, e.g. "wba", "ebu-male", "british-boxers". */
  id: string;
  /** Human label for the admin dashboard. */
  label: string;
  /** Trust tier of this source (drives confidence + the Verified/Official badge). */
  trust: TrustLevel;
  /** Whether this source is legally cleared to ingest (default false — opt-in per source). */
  licensed: boolean;
  /**
   * Fetch + parse the source into normalized entries. Implementations own their
   * own fetch, timeout and parsing; they MUST NOT touch Prisma or the engine.
   * Throwing is fine — the runner records the failure and continues other sources.
   */
  fetch(): Promise<RankingEntry[]>;
}

/** Confidence (0–100) for a connector's rows, from its trust tier. */
export function confidenceOf(c: Pick<RankingConnector, "trust">): number {
  return TRUST[c.trust];
}

// A small, safe normalizer every connector can use so weight-class labels and
// country codes don't drift between sources. Kept dependency-free.
const WEIGHT_ALIASES: Record<string, string> = {
  "super lightweight": "Super Lightweight",
  "jr welterweight": "Super Lightweight",
  "junior welterweight": "Super Lightweight",
  "light welterweight": "Super Lightweight",
  "super featherweight": "Super Featherweight",
  "jr lightweight": "Super Featherweight",
  cruiser: "Cruiserweight",
  heavy: "Heavyweight",
};

export function normalizeWeightClass(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  // Title-case from the lowercased key so all-caps source labels ("HEAVYWEIGHT")
  // come out "Heavyweight", not left shouting.
  return WEIGHT_ALIASES[key] ?? key.replace(/\b\w/g, (m) => m.toUpperCase());
}
