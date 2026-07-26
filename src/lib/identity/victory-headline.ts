// Pure headline + social-proof logic for a Prediction Victory Card. NO
// server-only, NO prisma — the deterministic core, extracted so it can be
// unit-tested without a database (same split as scoring.ts / streak-math.ts).
//
// A card only ever states what is TRUE of the pick it describes. Every input
// here is a stored, point-in-time-exact fact about one resolved pick (did it
// land, what share of the crowd agreed, what the reputation delta was) or a
// value we only pass when we can prove it (streak only when this is the user's
// latest resolved pick — see victory-card.ts). Nothing is inferred or inflated.

/** The three method families a user can call, collapsed from the granular enum. */
export type MethodFamily = "KO" | "SUB" | "DEC";

/** Map a stored FightMethod (KO/TKO/UD/SD/MD/SUB/RTD/TD/…) to its family. */
export function methodFamily(method: string | null | undefined): MethodFamily | null {
  if (!method) return null;
  const m = method.toUpperCase();
  if (m === "KO" || m === "TKO") return "KO";
  if (m === "SUB" || m === "RTD") return "SUB";
  if (m === "UD" || m === "SD" || m === "MD" || m === "TD") return "DEC";
  return null; // DQ / NC / DRAW — not a called-able finish
}

export interface CardFacts {
  correct: boolean;
  /** Share of the crowd (0..100) that picked the SAME corner. Lower = rarer call. */
  calledByPct: number;
  /** Total picks on the bout — a % is not meaningful below a quorum. */
  crowdTotal: number;
  confidence: number | null;
  /** The stored fight method family (how it actually ended). */
  resultMethod: MethodFamily | null;
  /** The method the USER called, if they called one. */
  calledMethod: MethodFamily | null;
  /** Consecutive-correct run ending at this pick — ONLY set when provable. */
  streak: number | null;
  titleFight: boolean;
}

export type HeadlineKind = "win" | "loss";

export interface Headline {
  text: string;
  kind: HeadlineKind;
}

// A % is only quoted when enough people picked to make it mean something. Below
// this, "only 8% saw it coming" is noise about three strangers, not a signal.
// Exported as the ONE quorum — the badge module and the card dedup share it.
export const QUORUM = 12;

/**
 * The one line at the top of the card. Priority order runs rarest/most-impressive
 * first so the headline reflects the single most remarkable true thing about the
 * call. Every branch is defensible from the facts alone.
 */
export function predictionHeadline(f: CardFacts): Headline {
  if (!f.correct) {
    // Dignified, never mocking (design principle: no casino, no dunking). A loss
    // still moves identity — the card is honest about that without twisting the
    // knife.
    if (f.streak !== null && f.streak === 0 && f.confidence !== null && f.confidence >= 4) {
      return { text: "Backed it hard. Didn't land.", kind: "loss" };
    }
    return { text: "The other corner took it.", kind: "loss" };
  }

  const hasQuorum = f.crowdTotal >= QUORUM;
  const calledFinish =
    f.calledMethod !== null && f.resultMethod !== null && f.calledMethod === f.resultMethod;

  // 1 — a genuinely rare, contrarian, correct call.
  if (hasQuorum && f.calledByPct <= 15) {
    return { text: `Only ${f.calledByPct}% saw it coming.`, kind: "win" };
  }
  // 2 — the upset call.
  if (hasQuorum && f.calledByPct <= 33) {
    return { text: "You called the upset.", kind: "win" };
  }
  // 3 — a hot streak is its own headline.
  if (f.streak !== null && f.streak >= 5) {
    return { text: `${f.streak}-fight win streak.`, kind: "win" };
  }
  if (f.streak !== null && f.streak >= 3) {
    return { text: "Another one.", kind: "win" };
  }
  // 4 — called the FINISH (winner AND method), backed with confidence.
  if (calledFinish && (f.confidence ?? 0) >= 4) {
    return { text: "Called the finish.", kind: "win" };
  }
  // 5 — high-confidence correct call.
  if ((f.confidence ?? 0) >= 4) {
    return { text: "Perfect call.", kind: "win" };
  }
  // 6 — a title bout is a bigger stage.
  if (f.titleFight) {
    return { text: "Called the title.", kind: "win" };
  }
  return { text: "Called it.", kind: "win" };
}

/**
 * The social-proof line — always a true statement about the crowd, or null when
 * the crowd is too small to quote. "Beat X% of callers" = the share who picked
 * the other corner (100 − calledByPct).
 */
export function socialProofLine(f: CardFacts): string | null {
  if (f.crowdTotal < QUORUM) return null;
  const beat = 100 - f.calledByPct;
  if (f.correct) {
    if (beat >= 50) return `You beat ${beat}% of callers on this one.`;
    // The crowd mostly agreed — say so honestly rather than spin a small number.
    return `${f.calledByPct}% of callers had it too.`;
  }
  // On a miss, the honest crowd fact is how many also got it wrong (no comfort spin).
  return `${f.calledByPct}% of callers took the same corner.`;
}
