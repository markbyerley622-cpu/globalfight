import type { PickStatus } from "@/lib/intelligence/pick-status";

// ════════════════════════════════════════════════════════════════════════════
//  The PROFILE DOMAIN — the shapes every profile surface reads.
//
//  Deliberately framed as what a READER of a profile needs, not as a mirror of
//  the tables. A profile card needs "who they picked" and "what the room
//  thinks"; it does not need a corner enum and a crowd tuple that every caller
//  then re-derives into the same two sentences. Doing that mapping once, here,
//  is what stops the third surface from getting it subtly different.
//
//  ── Designed for what comes next ─────────────────────────────────────────
//  Activity, Statistics, Achievements and the favourites rails are all coming.
//  They are NOT built here, but the service is shaped so they are additive:
//  every section is its own `ProfileSection` fetched by its own function, and
//  `getProfileOverview` composes whichever ones a surface asks for. Adding
//  Activity later is a new fetcher plus one line in the composer — not another
//  pass over the profile page.
// ════════════════════════════════════════════════════════════════════════════

/** Which corner a pick backed, in the reader's language rather than the enum's. */
export type PickCorner = "RED" | "BLUE";

/** The finish a member called, already turned into words. */
export type FinishLabel = "KO/TKO" | "Submission" | "Decision" | null;

/** Where a member's own challenge on this bout stands. */
export interface PickChallenge {
  state: "WAITING" | "ACTIVE" | "RESOLVED" | "CANCELLED";
  /** Public display name of the other side, when there is one. */
  opponentName: string | null;
  opponentUsername: string | null;
}

/**
 * ONE ACTIVE PICK — a fight that has not happened yet, with a call on it.
 *
 * Everything the card renders is resolved server-side, including the crowd
 * split and the challenge. A profile showing twenty picks must not become
 * twenty crowd queries, and the client must never be asked to work out who is
 * winning a vote it can only see part of.
 */
export interface CurrentPick {
  fightSlug: string;
  eventSlug: string | null;
  eventName: string | null;
  promotion: string | null;
  /** ISO. The fight's own date, which is what the countdown counts to. */
  date: string;
  redName: string;
  blueName: string;
  redSlug: string | null;
  blueSlug: string | null;
  /** Which corner this member backed. */
  corner: PickCorner;
  /** The fighter they backed, resolved — the card should not re-derive it. */
  pickedName: string;
  finish: FinishLabel;
  /** Percentage of the room on the SAME side as this member, 0–100. */
  crowdWithPct: number | null;
  crowdTotal: number;
  /** Picks close at first bell; a locked card must not look changeable. */
  picksClosed: boolean;
  challenge: PickChallenge | null;
}

/** ONE SETTLED PICK — a fight that happened, and how the call went. */
export interface ResultPick {
  fightSlug: string;
  redName: string;
  blueName: string;
  /** The fighter this member backed. */
  pickedName: string;
  /** Who actually won, or null for a draw / no contest / missing result. */
  winnerName: string | null;
  finish: FinishLabel;
  /** Derived server-side from the ONE shared predicate (pick-status). */
  status: PickStatus;
  /** True/false once graded; null while the outcome is not decided. */
  correct: boolean | null;
  /**
   * Reputation actually credited for this bout, read from the ReputationEvent
   * ledger — never recomputed. The scoring formula has changed before, and a
   * profile that re-derives points would quietly disagree with the balance the
   * member can see on the leaderboard.
   */
  points: number | null;
  /** ISO date the bout finished. */
  date: string;
}

/**
 * Settled picks GROUPED BY EVENT.
 *
 * A member who calls a whole card produces twelve rows that all say the same
 * event name, which reads as noise and buries the one thing the reader wants —
 * how they did on that card. Grouping is done in the service so every surface
 * groups identically.
 */
export interface ResultGroup {
  eventSlug: string | null;
  eventName: string;
  promotion: string | null;
  /** ISO of the event, for ordering and for the group header. */
  date: string;
  picks: ResultPick[];
  /** Graded picks only — void and cancelled bouts are excluded from both. */
  correctCount: number;
  gradedCount: number;
}

/** What every profile surface gets, in one object. */
export interface ProfileOverview {
  currentPicks: CurrentPick[];
  /** True when there are more active picks than the caller asked for. */
  moreCurrent: boolean;
  recentResults: ResultGroup[];
  moreResults: boolean;
}

export interface OverviewOptions {
  /** Active picks to return. The section is a PREVIEW; "View all" is the list. */
  currentLimit?: number;
  /** Settled picks to consider before grouping. */
  resultLimit?: number;
}
