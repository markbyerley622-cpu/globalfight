// ════════════════════════════════════════════════════════════════════════
//  Which tournaments to read, per sport.
//
//  One config table rather than a directory per sport: the mechanism is
//  identical for all of them (Wikipedia renders every championship bracket from
//  the same template family), so a sambo/ and a taekwondo/ folder would be the
//  same parser copied five times, drifting apart on the first bug fix. What
//  actually varies per sport is in here — the page titles, the governing body,
//  the bout format, and whether brackets exist at all.
// ════════════════════════════════════════════════════════════════════════

import type { Sport } from "@/lib/types";

export interface TournamentSource {
  /** CLI key, also the report label. */
  key: string;
  sport: Sport;
  /** Governing body, stored as Event.promotion. */
  promotion: string;
  /**
   * Hub page titles, `{year}` substituted. A title that does not exist is a
   * cheap 404 and is simply skipped, so listing an Olympic pattern for every
   * year costs three misses per cycle and needs no calendar logic.
   */
  hubs: string[];
  /** Periods/rounds a bout is scheduled for — Fight.scheduledRounds defaults to 12 (boxing). */
  scheduledRounds: number;
  /**
   * MEDALS ONLY: English Wikipedia has no brackets and no per-division
   * sub-articles for this sport, so the single derivable bout per division is the
   * final (gold def. silver). See medals.ts for why that is stated rather than
   * guessed, and what is deliberately not taken.
   */
  medalsOnly?: boolean;
  /**
   * Where a bout from a table headed "combat sambo" belongs. Sambo and combat
   * sambo are contested at the same championship and are different sports in our
   * enum, so one hub page yields two events.
   */
  combatSport?: Sport;
}

export const TOURNAMENT_SOURCES: TournamentSource[] = [
  {
    key: "wrestling",
    sport: "WRESTLING",
    promotion: "United World Wrestling",
    hubs: ["{year} World Wrestling Championships", "Wrestling at the {year} Summer Olympics"],
    // Two three-minute periods.
    scheduledRounds: 2,
  },
  {
    key: "taekwondo",
    sport: "TAEKWONDO",
    promotion: "World Taekwondo",
    hubs: ["{year} World Taekwondo Championships", "Taekwondo at the {year} Summer Olympics"],
    // Best of three rounds.
    scheduledRounds: 3,
  },
  {
    key: "judo",
    sport: "JUDO",
    promotion: "International Judo Federation",
    hubs: ["{year} World Judo Championships", "Judo at the {year} Summer Olympics"],
    // One four-minute contest, then golden score.
    scheduledRounds: 1,
  },
  {
    key: "sambo",
    sport: "SAMBO",
    promotion: "FIAS",
    hubs: ["{year} World Sambo Championships", "{year} European Sambo Championships"],
    scheduledRounds: 1,
    medalsOnly: true,
    combatSport: "COMBAT_SAMBO",
  },
  {
    key: "bjj",
    sport: "BJJ",
    promotion: "ADCC",
    // ADCC worlds are biennial (even years); odd-year titles 404 and are skipped.
    hubs: ["{year} ADCC World Championship"],
    scheduledRounds: 1,
    medalsOnly: true,
  },
];

export const sourceFor = (key: string): TournamentSource | undefined =>
  TOURNAMENT_SOURCES.find((s) => s.key === key.toLowerCase());
