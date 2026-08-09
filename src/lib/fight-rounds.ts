// ════════════════════════════════════════════════════════════════════════════
//  WHETHER A BOUT'S SCHEDULED DISTANCE IS A FACT OR A COLUMN DEFAULT.
//
//  ── The defect this closes ────────────────────────────────────────────────
//  `Fight.scheduledRounds` is `Int @default(12)` and NOT NULL, and the persist
//  chokepoint writes `stub.scheduledRounds ?? 12`. Twelve rounds is a BOXING
//  championship distance. So every bout whose source never stated a distance —
//  which is most of them outside boxing — is stored claiming twelve rounds, and
//  the event page printed that claim verbatim:
//
//      Bout 12 · 12 rds        ← an MMA bout
//      Flyweight · 12 rds      ← a Muay Thai bout
//
//  Production verification found this on ONE cards, where a single night mixes
//  MMA, Muay Thai, kickboxing and grappling. No bout in any of those rulesets is
//  ever scheduled for twelve rounds; MMA runs 3 or 5, Muay Thai and kickboxing
//  3 or 5, grappling is not scored in rounds at all.
//
//  ── Why this is a derive module and not an `if` in the row ────────────────
//  The stored 12 cannot be repaired by looking at it: a real twelve-round boxing
//  bout and an MMA bout that never had a distance are the same integer. Only the
//  bout's RULESET separates them, so the decision needs both values together,
//  and it needs to be made identically on the event page and the fight page.
//  Two copies of that rule is how the fight page kept printing "12 rounds" after
//  the event page stopped.
//
//  The rule, stated once: a distance is shown when it is credible for the
//  discipline the bout was contested under. When it is not, it is OMITTED —
//  never replaced with a guess. An unknown distance is a gap, and this codebase
//  prints gaps rather than inventing values (see Fight.ruleset's own default,
//  and cardSegment: "we never present a guessed broadcast block as fact").
// ════════════════════════════════════════════════════════════════════════════

/**
 * The value `Fight.scheduledRounds` falls back to when nothing supplied one.
 *
 * Exported because the rule below is ABOUT this number: it is exactly the value
 * that cannot be distinguished from real data, and a test asserts that.
 */
export const BOXING_DEFAULT_ROUNDS = 12;

/**
 * Disciplines actually contested over a twelve-round championship distance.
 *
 * Boxing alone. Bare-knuckle is deliberately absent: BKFC runs five rounds, so a
 * bare-knuckle bout carrying twelve is the column default showing through just
 * as surely as an MMA one.
 */
const TWELVE_ROUND_DISCIPLINES = new Set(["BOXING"]);

/**
 * Which discipline answers for this bout.
 *
 * The bout's own ruleset wins whenever it has one. UNKNOWN is not an answer —
 * it is the enum's explicit "we were not told" — so it falls through to the
 * card's sport, which is right for a single-ruleset promotion (a boxing card is
 * boxing throughout) and is the only signal available for the many rows written
 * before per-bout rulesets were captured.
 */
export function effectiveDiscipline(
  ruleset?: string | null,
  eventSport?: string | null,
): string | null {
  const r = (ruleset ?? "").toUpperCase();
  if (r && r !== "UNKNOWN") return r;
  const s = (eventSport ?? "").toUpperCase();
  return s || null;
}

/**
 * The scheduled distance to SHOW for a bout, or null to show nothing.
 *
 * Returns null — rather than a substitute number — whenever the stored value
 * cannot be trusted, because omitting a fact is honest and inventing one is not.
 *
 * A distance the source actually supplied is never suppressed: only the exact
 * boxing default is treated as untrustworthy, so an MMA bout stored as 3 or 5
 * rounds still displays, and so does a genuine twelve-round boxing bout.
 */
export function displayRounds(
  scheduledRounds: number | null | undefined,
  ruleset?: string | null,
  eventSport?: string | null,
): number | null {
  if (typeof scheduledRounds !== "number") return null;
  if (!Number.isInteger(scheduledRounds) || scheduledRounds < 1) return null;

  // Any value the boxing default cannot account for came from a source, and is
  // shown whatever the discipline — including disciplines this module has never
  // heard of, which must degrade to "trust the data", not to silence.
  if (scheduledRounds !== BOXING_DEFAULT_ROUNDS) return scheduledRounds;

  // Exactly twelve. Credible only where twelve rounds is a real distance; for
  // everything else — and for a bout whose discipline we cannot establish at
  // all — this is the column default and must not be presented as a fact.
  const discipline = effectiveDiscipline(ruleset, eventSport);
  if (discipline && TWELVE_ROUND_DISCIPLINES.has(discipline)) return scheduledRounds;
  return null;
}
