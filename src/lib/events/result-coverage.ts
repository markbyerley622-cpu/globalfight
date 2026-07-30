// ════════════════════════════════════════════════════════════════════════════
//  How complete are an event's RESULTS? ONE definition, PURE.
//
//  This exists because three different places were answering the question with
//  three different answers, and the user could see two of them disagree on one
//  screen:
//
//    • the event header rendered "Awaiting results · Results pending" from
//      event.status alone, while the card below it displayed a finished bout with
//      "TKO Round 7" — the page contradicting itself;
//    • the harvester called an event `verified` on any coverage at all, then later
//      on ≥90%, neither of which is "the event is complete";
//    • results:doctor described the same event a third way.
//
//  So completeness is defined once, here, and every surface derives from it.
//
//  ── Why states and not a percentage ──────────────────────────────────────
//
//  A percentage cannot express the thing that matters, which is whether MORE IS
//  COMING. 11 of 14 bouts is either "still arriving" or "all the source will ever
//  have", and those need opposite handling: the first should be retried, the second
//  should stop being retried and should stop telling the reader to wait.
//
//  Measured on production: after the BKFC sweep roughly half of all real events sat
//  between 67% and 89% — one or two bouts short, because a card routinely carries
//  bouts Wikipedia never lists (scratched bouts, unaired prelims). Under a pure
//  threshold every one of those is permanently "incomplete", re-attempted forever,
//  and permanently shows a reader a spinner for data that does not exist. That is
//  the mirror image of the bug where 1-of-13 reported as complete: both are the
//  system asserting something it does not know.
//
//  CONVERGENCE is what resolves it. If we have attempted an event repeatedly and
//  coverage has stopped moving, the honest statement is not "complete" and not
//  "pending" — it is "this is everything the source published".
// ════════════════════════════════════════════════════════════════════════════

/**
 * Attempts with no improvement in coverage before an event is considered converged.
 *
 * 2, not 1: a single failed attempt is routine (a rate limit, a page not yet
 * updated the morning after a card). Two consecutive attempts that add nothing is
 * a pattern.
 */
export const CONVERGENCE_ATTEMPTS = Number(process.env.RESULT_CONVERGENCE_ATTEMPTS ?? 3);

export type ResultCoverageState =
  /** Every bout on the card has an outcome. The only state that claims completeness. */
  | "CONFIRMED"
  /** Some outcomes are in and more may still arrive. Keep retrying. */
  | "UPDATING"
  /**
   * Some outcomes are in and the source has stopped yielding more. Terminal:
   * stop retrying, and stop telling the reader to wait for the rest.
   */
  | "SOURCE_EXHAUSTED"
  /** Nothing yet, and it is still early enough to expect something. */
  | "AWAITING"
  /** Nothing, repeatedly. No source covers this card. Terminal. */
  | "NO_SOURCE";

/** True when the state will not change without new information from outside. */
export function isTerminal(state: ResultCoverageState): boolean {
  return state === "CONFIRMED" || state === "SOURCE_EXHAUSTED" || state === "NO_SOURCE";
}

/** True when the harvester should keep spending requests on this event. */
export function shouldRetry(state: ResultCoverageState): boolean {
  return !isTerminal(state);
}

export interface CoverageInput {
  /** Bouts on the card. */
  total: number;
  /** Bouts that carry an outcome. */
  decided: number;
  /** Event.resultAttempts — how many times the harvester has tried. */
  attempts: number;
  /**
   * Event.resultCoverage — the percentage the PREVIOUS attempt achieved.
   *
   * Convergence is "attempts are no longer improving things", which needs the prior
   * value to compare against. Null means we have never recorded one.
   */
  lastCoveragePct: number | null;
}

export interface Coverage {
  state: ResultCoverageState;
  /** 0–100, rounded. 100 only when every bout is decided. */
  pct: number;
  decided: number;
  total: number;
  /** Reader-facing headline. The ONE source of this string. */
  label: string;
  /** Reader-facing detail line, or null when the label says enough. */
  detail: string | null;
}

/**
 * Classify an event's result completeness.
 *
 * COMPLETE requires every bout, on every card size — no threshold. A threshold was
 * tried and it is the wrong instrument: at 90% a 2-bout card can never pass (1 of 2
 * is 50%), while a 14-bout card passes at 13 and then claims to be finished while
 * visibly missing a fight. "Complete" should mean complete, and the genuinely-short
 * cards are handled by convergence instead, which is what they actually are.
 */
export function resultCoverage(input: CoverageInput): Coverage {
  const total = Math.max(0, input.total);
  const decided = Math.min(Math.max(0, input.decided), total);
  const pct = total === 0 ? 0 : Math.round((decided / total) * 100);
  const remaining = total - decided;

  const base = { pct, decided, total };

  // A card with no bouts is not a results problem — see events/card-completeness.
  if (total === 0) {
    return { ...base, state: "AWAITING", label: "Card not published", detail: null };
  }

  if (remaining === 0) {
    return { ...base, state: "CONFIRMED", label: "Results confirmed", detail: null };
  }

  // Has trying stopped helping? `lastCoveragePct` is what the previous attempt
  // achieved; if we are still at that number after CONVERGENCE_ATTEMPTS tries, the
  // source has given us everything it has.
  const stalled =
    input.attempts >= CONVERGENCE_ATTEMPTS &&
    input.lastCoveragePct !== null &&
    pct <= input.lastCoveragePct;

  if (decided === 0) {
    return stalled
      ? {
          ...base,
          state: "NO_SOURCE",
          label: "No published results",
          detail: "No source we can use has published results for this card.",
        }
      : { ...base, state: "AWAITING", label: "Awaiting results", detail: "Sources are checked hourly." };
  }

  if (stalled) {
    return {
      ...base,
      state: "SOURCE_EXHAUSTED",
      label: "Results confirmed",
      // Says what is missing AND that waiting will not fix it — the previous copy
      // ("Sources are checked hourly") promised an update that was never coming.
      detail: `${decided} of ${total} bouts confirmed. No result was published for the other ${remaining}.`,
    };
  }

  return {
    ...base,
    state: "UPDATING",
    label: "Results updating",
    detail: `${decided} of ${total} bouts confirmed — sources are checked hourly.`,
  };
}
