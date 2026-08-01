// ════════════════════════════════════════════════════════════════════════
//  Tournament provider — shared types.
//
//  The MMA/boxing world publishes a CARD: a flat list of "A def. B, KO, R2".
//  Sambo, taekwondo, wrestling, judo and BJJ do not. They publish a BRACKET (or,
//  when even that is missing, a medal table), and the bout only exists as a pair
//  of adjacent cells in a rendered elimination tree.
//
//  So this provider reconstructs bouts from tournament structure, and everything
//  here describes that structure rather than a card.
// ════════════════════════════════════════════════════════════════════════

/** One reconstructed bout, before it is mapped to a canonical fight stub. */
export interface TournamentBout {
  /** "Final", "Semifinals", "Round of 16", "Repechage"… or null when unlabelled. */
  round: string | null;
  /** Sort weight — Final is highest. Drives orderOnCard and mainEvent. */
  rank: number;
  redName: string;
  /** Alpha-3 as printed in the bracket ("USA", "JPN"), when present. */
  redCountry: string | null;
  blueName: string;
  blueCountry: string | null;
  /**
   * Which corner the SOURCE marks as having advanced, or null when the bracket
   * shows the pairing but no outcome. Null means we write the bout SCHEDULED —
   * we never infer a winner we were not told.
   */
  winner: "red" | "blue" | null;
  /** Raw score text as printed ("10", "11F", "VSU", "9 13"). Diagnostic only. */
  redScore: string | null;
  blueScore: string | null;
  /**
   * Per-bout division, when the bout came from a page that covers SEVERAL of
   * them. A bracket page is one division, so its bouts inherit the card's; a
   * medal table lists every division at once, so each of its bouts carries its own.
   */
  division?: string;
  /**
   * How this bout was established:
   *   "bracket"     — read off an elimination tree; the pairing is stated.
   *   "medal-final" — DERIVED: the medal table names a gold and a silver, and in
   *                   single-elimination those two contested the final. See medals.ts.
   */
  origin: "bracket" | "medal-final";
}

/** A division/weight-class competition — what becomes one Event row. */
export interface TournamentCard {
  /** The Wikipedia page title this came from — the provenance ref. */
  sourceTitle: string;
  /** Event name as we will store it. */
  name: string;
  /** Division label ("Men's freestyle 74 kg"), used as the bout weight class. */
  division: string | null;
  /** ISO date, or null when no date could be read (such a card is skipped). */
  date: string | null;
  venue: string | null;
  city: string | null;
  country: string | null;
  bouts: TournamentBout[];
}

export interface TournamentReport {
  /** Hub pages we asked for. */
  hubsTried: number;
  /** Hub pages that existed. */
  hubsFound: number;
  /** Division sub-articles fetched. */
  divisionsFetched: number;
  bracketBouts: number;
  medalBouts: number;
  /** Pages fetched but usable for nothing, with the reason. */
  skipped: { title: string; why: string }[];
  /** Network/parse failures, kept separate from "the source has no data". */
  warnings: string[];
}
