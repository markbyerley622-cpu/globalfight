// ════════════════════════════════════════════════════════════════════════════
//  Prediction terminal states — DERIVED, never stored.
//
//  PURE. No prisma, no server-only.
//
//  The old model had one bit: FightPick.correct (null | true | false), and the UI
//  called anything with a SCHEDULED fight "Open". That single word covered four
//  materially different situations:
//
//    • the fight hasn't happened yet            → OPEN            (fine)
//    • the fight is over, no result ingested     → AWAITING_RESULT (a data gap)
//    • the result exists, settlement never ran   → AWAITING_SETTLEMENT (a BUG)
//    • the bout was a draw / no-contest          → VOID           (nothing owed)
//
//  Collapsing those into "Open" is why an unsettled prediction is indistinguishable
//  from one whose fight is next week — the reader cannot tell whether the system
//  is broken or the fight simply hasn't happened. Every one of these states is
//  derivable from data we already store, so this is a pure function rather than a
//  column that can drift out of sync with the fight it describes.
//
//  AWAITING_SETTLEMENT is the important one: it is the ONLY state that means the
//  system owes work. It should be transient (seconds), and if it persists, that is
//  the invariant "a persisted result converges everywhere" being violated —
//  surfaced by name instead of hidden behind "Open".
// ════════════════════════════════════════════════════════════════════════════

export type PickStatus =
  /** The bout hasn't happened. The call is live. */
  | "OPEN"
  /** The bout is over but no result has been ingested. Not our debt — a data gap. */
  | "AWAITING_RESULT"
  /** A result EXISTS and this pick still isn't graded. The system owes work. */
  | "AWAITING_SETTLEMENT"
  /** Graded, and the call landed. */
  | "SETTLED_CORRECT"
  /** Graded, and it didn't. */
  | "SETTLED_INCORRECT"
  /** Draw or no-contest — no winner to call, so nothing is owed and nothing counts. */
  | "VOID"
  /** The bout was scratched (injury, weight miss, withdrawal). */
  | "CANCELLED";

/** The minimum shape needed to derive a status. A structural subset of Fight. */
export interface StatusFight {
  result: string;
  date: string | Date;
  cancelled?: boolean | null;
  /** Set when the settlement engine finished this bout. */
  picksResolvedAt?: Date | string | null;
}

export interface StatusPick {
  correct: boolean | null;
}

/**
 * Grace period after the bell before an unresolved bout is called out as
 * AWAITING_RESULT rather than OPEN. A card takes hours to finish and sources take
 * longer to publish; flagging a bout the minute its scheduled start passes would
 * mark every live event as a data gap. Matches RESULTS_GRACE_HOURS in result-ops.
 */
export const RESULT_GRACE_HOURS = 12;

const DECIDED = new Set(["WIN", "DRAW", "NO_CONTEST"]);
const VOID_RESULTS = new Set(["DRAW", "NO_CONTEST"]);

export function pickStatus(
  pick: StatusPick,
  fight: StatusFight,
  now: Date = new Date(),
): PickStatus {
  if (fight.cancelled) return "CANCELLED";

  if (!DECIDED.has(fight.result)) {
    // No result recorded. Whether that's normal or a gap depends on the clock.
    const start = new Date(fight.date).getTime();
    const overdue = Number.isFinite(start) && now.getTime() - start > RESULT_GRACE_HOURS * 3_600_000;
    return overdue ? "AWAITING_RESULT" : "OPEN";
  }

  // A void bout has no winner to have called. It is graded (the engine stamps the
  // fight) but nothing is owed and nothing counts toward a record — so it must
  // NOT read as a miss, which is what storing correct=false made it do.
  if (VOID_RESULTS.has(fight.result)) return "VOID";

  if (pick.correct === true) return "SETTLED_CORRECT";
  if (pick.correct === false) return "SETTLED_INCORRECT";

  // A decisive result exists and this pick is ungraded. This is the drift state.
  return "AWAITING_SETTLEMENT";
}

/** Does this status mean the settlement engine still owes work on this pick? */
export function owesSettlement(status: PickStatus): boolean {
  return status === "AWAITING_SETTLEMENT";
}

/** Is this pick finished — no further state change expected? */
export function isTerminal(status: PickStatus): boolean {
  return (
    status === "SETTLED_CORRECT" ||
    status === "SETTLED_INCORRECT" ||
    status === "VOID" ||
    status === "CANCELLED"
  );
}

/** Does this status count toward a win/loss record? Only a graded, live call does. */
export function countsTowardRecord(status: PickStatus): boolean {
  return status === "SETTLED_CORRECT" || status === "SETTLED_INCORRECT";
}

/**
 * FIRST-BELL LOCK — are picks closed on this card?
 *
 * Once the card starts, picks close for the WHOLE event: results are entered in a
 * batch afterwards, so a bout whose outcome is already known but not yet recorded
 * would otherwise be pickable. castPick has always enforced this server-side; the
 * rule lives here so the UI enforces the SAME rule rather than a second copy of it.
 * A widget that looks live while the API refuses the write is how a reader ends up
 * staring at an interactive prediction on a fight that finished two days ago.
 */
export function picksLocked(eventDate: string | Date | null | undefined, now: Date = new Date()): boolean {
  if (!eventDate) return false;
  const start = new Date(eventDate).getTime();
  return Number.isFinite(start) && start <= now.getTime();
}

export interface StatusPresentation {
  label: string;
  /** One line of honest explanation — why the pick is in this state. */
  detail: string;
  tone: "open" | "pending" | "correct" | "incorrect" | "neutral";
}

/**
 * How each state reads to a person. AWAITING_SETTLEMENT deliberately does NOT say
 * "Open" — a reader whose fight has a winner and whose call is ungraded is looking
 * at a system fault, and telling them "Open" is telling them nothing.
 */
export const STATUS_PRESENTATION: Record<PickStatus, StatusPresentation> = {
  OPEN: { label: "Open", detail: "The bout hasn't happened yet.", tone: "open" },
  AWAITING_RESULT: {
    label: "Awaiting result",
    detail: "The bout is over — no confirmed result has landed yet.",
    tone: "pending",
  },
  AWAITING_SETTLEMENT: {
    label: "Settling",
    detail: "The result is in — grading your call now.",
    tone: "pending",
  },
  SETTLED_CORRECT: { label: "Correct", detail: "Your call landed.", tone: "correct" },
  SETTLED_INCORRECT: { label: "Missed", detail: "Your call didn't land.", tone: "incorrect" },
  VOID: {
    label: "Void",
    detail: "Draw or no contest — this one doesn't count either way.",
    tone: "neutral",
  },
  CANCELLED: { label: "Cancelled", detail: "The bout was scratched.", tone: "neutral" },
};
