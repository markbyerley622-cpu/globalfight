import { TRUST, type TrustLevel } from "./connector";
import { RANKING_SOURCES } from "./sources";

// ════════════════════════════════════════════════════════════════════════
//  Ingest rules — PURE functions (no Prisma, no I/O) so identity resolution,
//  source precedence and movement are unit-tested in isolation. ingest.ts wires
//  these to the database.
// ════════════════════════════════════════════════════════════════════════

/** Divisions heaviest → lightest; index is the WeightClass display order. */
export const DIVISION_ORDER = [
  "Heavyweight", "Bridgerweight", "Cruiserweight", "Light Heavyweight",
  "Super Middleweight", "Middleweight", "Super Welterweight", "Welterweight",
  "Super Lightweight", "Lightweight", "Super Featherweight", "Featherweight",
  "Super Bantamweight", "Bantamweight", "Super Flyweight", "Flyweight",
  "Light Flyweight", "Minimumweight",
];

export function divisionOrder(name: string): number {
  const i = DIVISION_ORDER.findIndex((d) => d.toLowerCase() === name.trim().toLowerCase());
  return i === -1 ? 99 : i;
}

/** URL/identity slug from a fighter's display name. Stable → dedupes by slug. */
export function fighterSlug(name: string): string {
  return name
    .normalize("NFKD").replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** WeightClass slug, namespaced by sport so "Heavyweight" is unique per sport. */
export function weightClassSlug(sport: string, name: string): string {
  const base = fighterSlug(name);
  return sport.toLowerCase() === "boxing" ? base : `${sport.toLowerCase()}-${base}`;
}

// ── Source precedence ─────────────────────────────────────────────────────
// Hand-entered rows are sacrosanct; otherwise a higher-trust source wins, and a
// source always refreshes its own rows.

const SOURCE_TRUST: Record<string, number> = Object.fromEntries(
  RANKING_SOURCES.map((s) => [s.id, TRUST[s.trust]]),
);

/** Numeric trust of a stored ranking's `source` string. Manual/curated is absolute. */
export function trustOf(source: string | null | undefined): number {
  if (!source) return 0;
  if (source === "curated" || source === "manual") return Number.POSITIVE_INFINITY;
  return SOURCE_TRUST[source] ?? TRUST.unknown;
}

/**
 * May an incoming row from `incomingSource` overwrite an existing row?
 *   - nothing there            → yes
 *   - existing is manual/curated → never
 *   - same source              → yes (a refresh)
 *   - else                     → only if incoming trust ≥ existing trust
 */
export function shouldWriteRanking(
  existingSource: string | null | undefined,
  incomingSource: string,
): boolean {
  if (!existingSource) return true;
  if (existingSource === incomingSource) return true;
  return trustOf(incomingSource) >= trustOf(existingSource);
}

export type Movement = "UP" | "DOWN" | "SAME" | "NEW";

/** Rank movement from a previous rank (null = newly ranked). */
export function movementFor(previous: number | null | undefined, next: number): Movement {
  if (previous == null) return "NEW";
  if (next < previous) return "UP";
  if (next > previous) return "DOWN";
  return "SAME";
}

/** Confidence (0–100) to display for a stored source string. */
export function confidenceForSource(source: string | null | undefined): number {
  if (source === "curated" || source === "manual") return 100;
  const s = RANKING_SOURCES.find((x) => x.id === source);
  return s ? TRUST[s.trust] : TRUST.unknown;
}

export const TRUST_LABEL: Record<TrustLevel, string> = {
  official: "Official", commission: "Commission", promotion: "Promotion",
  federation: "Federation", media: "Media", community: "Community", unknown: "Unverified",
};
