// Single source of truth for the combat-sport taxonomy. Values match the
// Prisma `Sport` enum and the TS `Sport` union in types.ts.

export const SPORTS = [
  { value: "MMA", label: "MMA", slug: "mma", recordType: "wld-nc" },
  { value: "BOXING", label: "Boxing", slug: "boxing", recordType: "wld" },
  { value: "MUAY_THAI", label: "Muay Thai", slug: "muay-thai", recordType: "wld" },
  { value: "KICKBOXING", label: "Kickboxing", slug: "kickboxing", recordType: "wld" },
  { value: "BARE_KNUCKLE", label: "Bare Knuckle", slug: "bare-knuckle", recordType: "wld" },
  { value: "BJJ", label: "BJJ", slug: "bjj", recordType: "belt" },
  { value: "BJJ_NOGI", label: "No-Gi BJJ", slug: "no-gi-bjj", recordType: "belt" },
  { value: "WRESTLING", label: "Wrestling", slug: "wrestling", recordType: "style" },
  { value: "JUDO", label: "Judo", slug: "judo", recordType: "rank" },
  { value: "TAEKWONDO", label: "Taekwondo", slug: "taekwondo", recordType: "rank" },
  { value: "SAMBO", label: "Sambo", slug: "sambo", recordType: "wld" },
  { value: "COMBAT_SAMBO", label: "Combat Sambo", slug: "combat-sambo", recordType: "wld" },
] as const;

export type SportValue = (typeof SPORTS)[number]["value"];

export const SPORT_LABEL: Record<string, string> = Object.fromEntries(
  SPORTS.map((s) => [s.value, s.label]),
);
export const SPORT_BY_SLUG: Record<string, (typeof SPORTS)[number]> = Object.fromEntries(
  SPORTS.map((s) => [s.slug, s]),
);

/** Format a fighter's competitive record for their sport. */
export function formatSportRecord(f: {
  sport: string; wins: number; losses: number; draws: number; noContests?: number;
}): string {
  const sport = SPORTS.find((s) => s.value === f.sport);
  // No record imported yet → "" so the UI shows nothing rather than "0-0-0".
  if (!f.wins && !f.losses && !f.draws && !f.noContests) return "";
  const base = `${f.wins}-${f.losses}-${f.draws}`;
  if (sport?.recordType === "wld-nc" && f.noContests) return `${base} (${f.noContests} NC)`;
  return base;
}
