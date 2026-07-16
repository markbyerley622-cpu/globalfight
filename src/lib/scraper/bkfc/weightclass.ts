// ════════════════════════════════════════════════════════════════════════
//  BKFC provider — weight-class reference data.
//
//  BKFC uses standard combat-sport divisions. We map the label found on a
//  page to a canonical WeightClass row (slug prefixed "bk-" per the schema
//  convention, since division names repeat across sports). Unknown labels
//  return null and the fight is stored without a weight class rather than
//  inventing one.
// ════════════════════════════════════════════════════════════════════════

export interface BkfcWeightClass {
  name: string;
  slug: string; // "bk-heavyweight"
  limitLbs: number | null;
  order: number; // heaviest = 0, matches WeightClass.order convention
}

const DIVISIONS: BkfcWeightClass[] = [
  { name: "Heavyweight", slug: "bk-heavyweight", limitLbs: null, order: 0 },
  { name: "Cruiserweight", slug: "bk-cruiserweight", limitLbs: 205, order: 1 },
  { name: "Light Heavyweight", slug: "bk-light-heavyweight", limitLbs: 185, order: 2 },
  { name: "Middleweight", slug: "bk-middleweight", limitLbs: 175, order: 3 },
  { name: "Welterweight", slug: "bk-welterweight", limitLbs: 165, order: 4 },
  { name: "Lightweight", slug: "bk-lightweight", limitLbs: 155, order: 5 },
  { name: "Featherweight", slug: "bk-featherweight", limitLbs: 145, order: 6 },
  { name: "Bantamweight", slug: "bk-bantamweight", limitLbs: 135, order: 7 },
  { name: "Flyweight", slug: "bk-flyweight", limitLbs: 125, order: 8 },
  { name: "Strawweight", slug: "bk-strawweight", limitLbs: 115, order: 9 },
];

// Normalized-label → canonical, including common variants and abbreviations.
const INDEX = new Map<string, BkfcWeightClass>();
for (const d of DIVISIONS) INDEX.set(d.name.toLowerCase(), d);
INDEX.set("lhw", DIVISIONS[2]);
INDEX.set("light heavy", DIVISIONS[2]);
INDEX.set("welter", DIVISIONS[4]);
INDEX.set("feather", DIVISIONS[6]);
INDEX.set("bantam", DIVISIONS[7]);

/**
 * Map a division label (with optional "Women's" prefix and stray weight text)
 * to a canonical division. Women's divisions share the same weight bands here;
 * the caller keeps the original label on the fighter for display.
 */
export function mapWeightClass(label: string | null | undefined): BkfcWeightClass | null {
  if (!label) return null;
  const norm = label
    .toLowerCase()
    .replace(/women'?s|womens|men'?s|mens/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\d+\s*(lbs?|kg)/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!norm) return null;
  if (INDEX.has(norm)) return INDEX.get(norm) ?? null;
  // Fall back to a contains-match against the longest division names first.
  for (const d of DIVISIONS) {
    if (norm.includes(d.name.toLowerCase())) return d;
  }
  return null;
}

export const ALL_DIVISIONS = DIVISIONS;
