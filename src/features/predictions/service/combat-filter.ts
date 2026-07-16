// ════════════════════════════════════════════════════════════════════════
//  Combat-sport gating + classification (SERVER-SIDE).
//
//  Prediction providers surface everything from politics to crypto. This is the
//  single gate that decides (a) is this a combat-sports market at all, and (b)
//  which Combat Register sport it maps to. If a market cannot be *confidently*
//  mapped, it is dropped — we never guess a sport onto an unrelated market.
// ════════════════════════════════════════════════════════════════════════

import type { CombatSport } from "@/features/predictions/types";

/** Signals available for classification, gathered by each provider's adapter. */
export type ClassifyInput = {
  title: string;
  description?: string | null;
  /** Lowercased tag/category slugs & labels from the provider. */
  tags?: string[];
  /** Provider hint, e.g. Kalshi series ticker "KXUFCFIGHT". */
  hint?: string | null;
};

// Hard exclusions — categories that share vocabulary with combat but are noise.
// (A Polymarket "sports" tag alone is not enough; these veto outright.)
const EXCLUDE = [
  "politics", "election", "crypto", "bitcoin", "ethereum", "weather", "climate",
  "finance", "economics", "fed-rates", "stocks", "entertainment", "oscars",
  "nba", "nfl", "mlb", "nhl", "soccer", "premier-league", "tennis", "golf",
  "f1", "formula-1", "cricket", "esports",
];

// Ordered sport matchers — first hit wins, so put the most specific first
// (Misfits before generic Boxing, Bare Knuckle before Boxing, etc.).
const MATCHERS: { sport: CombatSport; any: RegExp }[] = [
  { sport: "Misfits", any: /\bmisfits\b|kingpyn|\bksi\b|\bmf\b(?:\s|&)|influencer box/i },
  { sport: "Bare Knuckle", any: /bare[-\s]?knuckle|\bbkfc\b|\bbyb\b/i },
  { sport: "MMA", any: /\bmma\b|\bufc\b|\bbellator\b|\bpfl\b|\bone championship\b|octagon|dana white/i },
  { sport: "Kickboxing", any: /kickbox|\bglory\b|\bk-?1\b/i },
  { sport: "Muay Thai", any: /muay[-\s]?thai|lumpinee|rajadamnern/i },
  { sport: "BJJ", any: /\bbjj\b|jiu[-\s]?jitsu|grappl|\badcc\b|\bibjjf\b/i },
  { sport: "Wrestling", any: /freestyle wrestl|greco[-\s]?roman|\buww\b|olympic wrestl/i },
  // Generic boxing last so "influencer boxing" etc. resolve to their niche first.
  { sport: "Boxing", any: /\bbox(?:ing|er)?\b|heavyweight|welterweight|middleweight|canelo|usyk|fury|joshua|\bwba\b|\bwbc\b|\bibf\b|\bwbo\b/i },
];

// A generic "is this combat at all" net — used to reject Polymarket markets that
// carry a combat-sports tag on the *event* but whose market text is off-topic.
const COMBAT_HINT =
  /\bmma\b|\bufc\b|box(?:ing|er)?|fight|knockout|\bko\b|\bkickbox|muay|jiu[-\s]?jitsu|\bbjj\b|grappl|bare[-\s]?knuckle|\bbkfc\b|wrestl|misfits|bellator|\bpfl\b/i;

const hasExcluded = (tags: string[]) =>
  tags.some((t) => EXCLUDE.some((x) => t.includes(x)));

/**
 * Classify a market into a combat sport, or null if it isn't confidently a
 * combat-sports market. Tag/hint signals are weighted over free text.
 */
export function classifySport(input: ClassifyInput): CombatSport | null {
  const tags = (input.tags ?? []).map((t) => t.toLowerCase());
  const hint = (input.hint ?? "").toLowerCase();

  // Provider series tickers are authoritative — recognise them first (their
  // sport keyword is embedded in a longer token the word-boundary rules miss).
  if (hint.startsWith("kxufcfight")) return "MMA";
  if (hint.startsWith("kxboxing")) return "Boxing";

  const haystack = `${input.title} ${input.description ?? ""} ${tags.join(" ")} ${hint}`;

  // Veto on excluded categories unless there's an unambiguous combat signal in
  // the title (guards against e.g. a "sports > nba" tag on a combat market).
  if (hasExcluded(tags) && !COMBAT_HINT.test(input.title)) return null;

  for (const m of MATCHERS) {
    if (m.any.test(haystack)) return m.sport;
  }
  return null;
}

/** True when the market is combat-sports and thus eligible to surface. */
export function isCombatMarket(input: ClassifyInput): boolean {
  return classifySport(input) !== null;
}

/** Best-effort promotion/league label from the signals, or null. */
export function leagueFrom(input: ClassifyInput): string | null {
  const s = `${input.title} ${(input.tags ?? []).join(" ")} ${input.hint ?? ""}`;
  if (/\bufc\b/i.test(s)) return "UFC";
  if (/\bbkfc\b|bare[-\s]?knuckle/i.test(s)) return "BKFC";
  if (/misfits|kingpyn/i.test(s)) return "Misfits";
  if (/\bpfl\b/i.test(s)) return "PFL";
  if (/\bbellator\b/i.test(s)) return "Bellator";
  if (/\bone championship\b/i.test(s)) return "ONE";
  if (/\bglory\b/i.test(s)) return "GLORY";
  return null;
}
