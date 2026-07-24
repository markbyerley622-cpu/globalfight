// ════════════════════════════════════════════════════════════════════════
//  Curated cross-sport Pound-for-Pound lists — SOURCE-BACKED, not invented.
//
//  Every entry below was transcribed from a named public ranking on the date
//  shown, and the source is stored so the UI can say exactly where it came from.
//  This file is the provenance store: it lives in git, so every change is a
//  reviewable, reversible, timestamped version (that IS the version history —
//  no ranking is ever silently overwritten or lost).
//
//  HARD RULES (enforced by review, not just convention):
//   • Never add a name a cited source does not rank.
//   • Never invent a country, record, or achievement — only fields the source
//     states are filled; unknown stays null.
//   • Boxing + MMA are intentionally ABSENT: they are driven by the rating engine
//     (+ official connectors). Curated fills only the sports the engine can't yet.
//   • Judo / Taekwondo / Sambo are intentionally ABSENT: their federations rank
//     per weight class only, and no defensible cross-weight P4P source was found.
//     They remain empty until one is — an empty sport is honest; a guessed one
//     is not.
//
//  Confidence rubric (surfaced on every card):
//   HIGH   — the sport's definitive P4P authority, current.
//   MEDIUM — a single reputable editorial ranking.
//   LOW    — sources disagree or the latest available list is dated.
// ════════════════════════════════════════════════════════════════════════

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface CuratedSource {
  label: string;
  url: string;
}

export interface CuratedEntry {
  /** Name exactly as the source publishes it (identity resolution normalises). */
  name: string;
  rank: number;
  /** ISO-3166 alpha-2, ONLY when the source states nationality — else null. */
  countryCode: string | null;
}

export interface CuratedList {
  /** Prisma Sport enum value. */
  sport: string;
  /** Effective date of the SOURCE list (its publication), ISO date. */
  updated: string;
  confidence: Confidence;
  /** Every source the list was compiled from (provenance, never lost). */
  sources: CuratedSource[];
  /** One honest line on how this list was compiled. */
  reason: string;
  entries: CuratedEntry[];
}

export const CURATED_P4P: CuratedList[] = [
  {
    sport: "BJJ",
    updated: "2026-07-11",
    confidence: "HIGH",
    sources: [
      { label: "FloGrappling — Men's P4P No-Gi", url: "https://www.flograppling.com/rankings/11183335-flograpplings-official-no-gi-rankings/46137-mens-pound-for-pound-no-gi-rankings" },
    ],
    reason: "Transcribed from FloGrappling's official men's no-gi pound-for-pound ranking, the sport's recognised authority.",
    entries: [
      { name: "Gordon Ryan", rank: 1, countryCode: "US" },
      { name: "Tye Ruotolo", rank: 2, countryCode: "US" },
      { name: "Mikey Musumeci", rank: 3, countryCode: "US" },
      { name: "Kaynan Duarte", rank: 4, countryCode: "BR" },
      { name: "Pedro Marinho", rank: 5, countryCode: "BR" },
      { name: "Kade Ruotolo", rank: 6, countryCode: "US" },
      { name: "Craig Jones", rank: 7, countryCode: "AU" },
      { name: "Diogo Reis", rank: 8, countryCode: "BR" },
      { name: "Diego Oliveira", rank: 9, countryCode: "BR" },
      { name: "Dante Leon", rank: 10, countryCode: "CA" },
    ],
  },
  {
    sport: "WRESTLING",
    updated: "2026-06-24",
    confidence: "HIGH",
    sources: [
      { label: "FloWrestling — 2026 Men's Freestyle P4P", url: "https://www.flowrestling.org/rankings/15906464-2026-mens-freestyle-international-wrestling-rankings/56286-pound-for-pound-abdulrashid-sadulaev" },
    ],
    reason: "Transcribed from FloWrestling's 2026 men's freestyle international pound-for-pound ranking.",
    entries: [
      { name: "Abdulrashid Sadulaev", rank: 1, countryCode: "RU" },
      { name: "Amir Zare", rank: 2, countryCode: "IR" },
      { name: "Rahman Amouzad", rank: 3, countryCode: "IR" },
      { name: "Kotaro Kiyooka", rank: 4, countryCode: "JP" },
      { name: "Zavur Uguev", rank: 5, countryCode: "RU" },
      { name: "Zaurbek Sidakov", rank: 6, countryCode: "RU" },
      { name: "Ibragim Kadiev", rank: 7, countryCode: "RU" },
      { name: "Amirreza Masoumi", rank: 8, countryCode: "IR" },
      { name: "Kyle Snyder", rank: 9, countryCode: "US" },
      { name: "Arash Yoshida", rank: 10, countryCode: "JP" },
    ],
  },
  {
    sport: "KICKBOXING",
    updated: "2026-07-01",
    confidence: "MEDIUM",
    sources: [
      { label: "Beyond Kickboxing — P4P Rankings", url: "https://beyondkick.com/rankings/" },
    ],
    reason: "Transcribed from Beyond Kickboxing's monthly pound-for-pound ranking (a reputable independent kickboxing outlet).",
    entries: [
      { name: "Kazuki Osaki", rank: 1, countryCode: "JP" },
      { name: "Petchpanomrung", rank: 2, countryCode: "TH" },
      { name: "Chico Kwasi", rank: 3, countryCode: "SR" },
      { name: "Koki Osaki", rank: 4, countryCode: "JP" },
      { name: "Superbon", rank: 5, countryCode: "TH" },
      { name: "Mory Kromah", rank: 6, countryCode: "GN" },
      { name: "Donovan Wisse", rank: 7, countryCode: "SR" },
      { name: "Mohamed Touchassie", rank: 8, countryCode: "MA" },
      { name: "Kento Haraguchi", rank: 9, countryCode: "JP" },
      { name: "Jonathan Haggerty", rank: 10, countryCode: "GB" },
    ],
  },
  {
    sport: "MUAY_THAI",
    updated: "2026-02-06",
    confidence: "MEDIUM",
    sources: [
      { label: "Muaythai.com — Best Muay Thai Fighters", url: "https://muaythai.com/best-muay-thai-fighters-in-the-world/" },
    ],
    reason: "Transcribed from Muaythai.com's world ranking, compiled with reference to IFMA and WBC Muaythai professional rankings.",
    entries: [
      { name: "Superlek Kiatmoo9", rank: 1, countryCode: "TH" },
      { name: "Khunsueklek Boomdeksian", rank: 2, countryCode: "TH" },
      { name: "Rodtang Jitmuangnon", rank: 3, countryCode: "TH" },
      { name: "Kumandoi Petchyindee", rank: 4, countryCode: "TH" },
      { name: "Dani Rodriguez", rank: 5, countryCode: null },
      { name: "Lamnamoonlek Tded99", rank: 6, countryCode: "TH" },
      { name: "Panpayak Jitmuangnon", rank: 7, countryCode: "TH" },
      { name: "Nadaka Yoshinari", rank: 8, countryCode: "JP" },
      { name: "Chaila Por.Lakboon", rank: 9, countryCode: "TH" },
      { name: "Tawanchai PK Saenchai", rank: 10, countryCode: "TH" },
    ],
  },
  {
    sport: "BARE_KNUCKLE",
    updated: "2026-04-13",
    confidence: "LOW",
    sources: [
      { label: "Martial Nerd — Top P4P Bare Knuckle", url: "https://www.martialnerd.com/posts/bare-knuckle-boxers" },
      { label: "BKFC — Latest Rankings", url: "https://www.bkfc.com/news/the-latest-bkfc-rankings" },
    ],
    reason: "BKFC does not publish a single authoritative P4P and available lists disagree; this reflects the champions who recur across sources. LOW confidence — order is not settled.",
    entries: [
      { name: "Lorenzo Hunt", rank: 1, countryCode: "US" },
      { name: "Luis Palomino", rank: 2, countryCode: "PE" },
      { name: "Mike Perry", rank: 3, countryCode: "US" },
      { name: "David Mundell", rank: 4, countryCode: "US" },
      { name: "Arnold Adams", rank: 5, countryCode: "US" },
    ],
  },
];

/** Provenance lookup by sport (for the UI badge). */
export function curatedProvenance(sportValue: string): Omit<CuratedList, "entries"> | null {
  const l = CURATED_P4P.find((x) => x.sport === sportValue);
  return l ? { sport: l.sport, updated: l.updated, confidence: l.confidence, sources: l.sources, reason: l.reason } : null;
}

/** Numeric confidence (0–100) for storage/sorting, from the HIGH/MEDIUM/LOW tier. */
export const CONFIDENCE_SCORE: Record<Confidence, number> = { HIGH: 90, MEDIUM: 75, LOW: 60 };
