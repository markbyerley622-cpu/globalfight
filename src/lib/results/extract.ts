// ════════════════════════════════════════════════════════════════════════════
//  Text → a structured, bout-scoped outcome candidate. PURE.
//
//  ── THE DESIGN DECISION THAT MAKES THIS SAFE ──────────────────────────────
//  This is NOT named-entity recognition over free text. It is given the TWO
//  fighters on a specific bout and asked whether the text says something about
//  THEM. It can only ever return "red won", "blue won", "draw", "no contest", or
//  nothing at all.
//
//  That inversion is the whole safety story. Open extraction would happily read
//  "Berlanga wants Munguia after Butler scare" as a Berlanga win, or attach a
//  result from the co-main to the main event. Bout-scoping means a sentence has to
//  name both of these fighters, in an order, around a verb we recognise — and if it
//  does not, we return null and the reader keeps seeing "Results pending", which is
//  the correct outcome for ambiguous text.
//
//  Everything is conservative on purpose:
//   · both surnames must appear, and they must be distinguishable from each other;
//   · the winner is decided by POSITION relative to the verb, never by sentiment;
//   · a method we cannot name stays null rather than being guessed as a decision;
//   · anything hedged ("reportedly", "set to", a question mark) is refused outright.
//
//  A wrong result is far more expensive than a slow one: settlement pays reputation,
//  grades predictions and fires notifications off the back of it.
// ════════════════════════════════════════════════════════════════════════════

export type Outcome = "WIN" | "DRAW" | "NO_CONTEST";
export type Corner = "RED" | "BLUE";

/** The methods this module is willing to name. Mirrors FightMethod. */
export type Method = "KO" | "TKO" | "UD" | "SD" | "MD" | "SUB" | "DQ" | "RTD" | "TD" | "NC" | "DRAW";

export interface Bout {
  redName: string;
  blueName: string;
}

export interface Extraction {
  outcome: Outcome;
  /** Null for a draw or no contest. */
  winner: Corner | null;
  method: Method | null;
  round: number | null;
  /** 0..1 — how well-formed this reading is, BEFORE source reliability is applied. */
  quality: number;
  /** Human-readable reasons, for the operator queue. */
  reasons: string[];
}

// ── text hygiene ────────────────────────────────────────────────────────────

const normalise = (s: string): string =>
  s
    .normalize("NFKD")
    // Strip diacritics so "Muñoz" matches "Munoz".
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const lower = (s: string) => normalise(s).toLowerCase();

/**
 * Language that means "this has not happened yet" or "we are not sure".
 *
 * Checked BEFORE anything else and fatal when found. "Berlanga set to face Butler"
 * and "Berlanga reportedly stops Butler" contain the same verbs as a result report,
 * and reading either as a result would settle a bout on a preview or a rumour.
 */
const HEDGES = [
  "reportedly", "rumou", "rumor", "allegedly", "claims to", "expected to", "set to",
  "will face", "to face", "preview", "prediction", "predicts", "picks", "how to watch",
  "odds", "betting", "weigh-in", "weigh in", "press conference", "if he", "if she",
  "could ", "would ", "may ", "might ", "wants", "eyes ", "targets", "calls out",
  "vows", "promises", "aims to", "looking to", "hopes to", "scheduled",
];

/** A headline that ASKS something is not reporting an outcome. */
const isQuestion = (text: string) => /\?/.test(text);

// ── name matching ───────────────────────────────────────────────────────────

const STOPWORDS = new Set(["jr", "sr", "ii", "iii", "iv", "the", "de", "da", "van", "von", "dos", "del"]);

/**
 * The tokens worth matching a fighter on — surname-weighted.
 *
 * Reports use surnames ("Berlanga stops Butler"), so a full-name requirement would
 * match almost nothing. Tokens shorter than three characters and generational
 * suffixes are dropped: matching on "Jr" would make every Jr the same person.
 */
export function nameTokens(name: string): string[] {
  return lower(name)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** The single most identifying token — the last usable one, i.e. the surname. */
function keyToken(name: string): string | null {
  const tokens = nameTokens(name);
  return tokens.length ? tokens[tokens.length - 1] : null;
}

/** Word-boundary index of a token, or -1. */
function indexOfToken(haystack: string, token: string): number {
  const m = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).exec(haystack);
  return m ? m.index : -1;
}

// ── method + round ──────────────────────────────────────────────────────────

/**
 * Verbs that assert a win, ordered so the most specific match first.
 *
 * `method: null` entries assert a WIN without naming how — "beats" and "defeats" are
 * genuinely method-agnostic, and inventing "UD" for them would be a fabrication that
 * a reader would see on the bout as fact.
 */
const WIN_VERBS: {
  re: RegExp;
  method: Method | null;
  /**
   * The verb's SUBJECT is the loser, with no "by" to signal it.
   *
   * English has three shapes here and all three appear in real headlines:
   *   active   "Berlanga stops Butler"        → subject won
   *   passive  "Butler stopped by Berlanga"   → subject lost, detected via "by"
   *   ergative "Butler disqualified", "Butler loses to Berlanga" → subject lost
   * Only the third needs marking, because there is no preposition to look for.
   */
  subjectLoses?: boolean;
}[] = [
  { re: /\bknocks? (?:him |her |them )?out\b/, method: "KO" },
  { re: /\bko(?:'?s|es)?\b/, method: "KO" },
  { re: /\bstops?\b|\bstoppage\b|\btko(?:'?s)?\b|\bstopped\b/, method: "TKO" },
  { re: /\bsubmits?\b|\bsubmission\b|\btaps? (?:him |her |them )?out\b|\bchokes? (?:him |her |them )?out\b/, method: "SUB" },
  // "Butler disqualified" — Butler lost. "Berlanga disqualifies Butler" — Berlanga
  // won. Same stem, opposite readings, so they are separate entries.
  { re: /\bdisqualified\b|\bdq'?d\b/, method: "DQ", subjectLoses: true },
  { re: /\bdisqualifies\b/, method: "DQ" },
  // Loser-first forms, which are extremely common in headlines.
  { re: /\bloses to\b|\bfalls to\b|\bsuccumbs to\b|\bbeaten by\b|\boutpointed by\b/, method: null, subjectLoses: true },
  { re: /\bretires\b|\bcorner retirement\b|\brtd\b/, method: "RTD" },
  { re: /\bunanimous decision\b/, method: "UD" },
  { re: /\bsplit decision\b/, method: "SD" },
  { re: /\bmajority decision\b/, method: "MD" },
  { re: /\btechnical decision\b/, method: "TD" },
  // Method-agnostic wins. Must come AFTER the specific forms: the list order is the
  // SPECIFICITY order, and the method is taken from the first entry that matches.
  // `\bdef\.\b` can NEVER match: `\b` after the period needs an adjacent word
  // character and a space always follows. Anchored on whitespace instead.
  { re: /\bdef\.(?=\s|$)|\bdefeats?\b|\bbeats?\b|\bbeaten\b|\bdowns\b|\boutpoints?\b|\boutworks\b|\bedges?\b|\bdominates?\b|\bwins? (?:against|over)\b|\bupsets?\b/, method: null },
];

/**
 * Passive constructions, where the fighter named FIRST is the loser.
 *
 * "Butler stopped by Berlanga" and "Berlanga stops Butler" are the same result with
 * the names in opposite orders, and a purely positional reader gets one of them
 * exactly backwards. Backwards is the worst possible failure here — it settles every
 * prediction on the bout for the wrong corner — so the passive form is detected
 * explicitly and inverts the reading.
 */
const PASSIVE_AFTER_VERB = /^\s*(?:out\s+)?by\b/;

const DRAW_RE = /\b(?:fight(?:s)? to a |ends? in a |battle to a )?draw\b|\bdrawn\b/;
const NC_RE = /\bno contest\b|\bruled a no contest\b/;

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6,
  seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/**
 * The round a stoppage happened in, or null.
 *
 * Only forms that explicitly reference a round. A bare number is never a round —
 * "Berlanga stops Butler, 3 knockdowns" would otherwise report round 3.
 */
export function extractRound(
  text: string,
  opts: {
    /**
     * Allow "in seven" to mean round seven.
     *
     * Off by default, because a bare cardinal is ambiguous in general English. The
     * caller turns it on when a STOPPAGE method is present — "stops him in seven"
     * has exactly one reading, and refusing it lost the round from a real headline
     * ("…Stop Steven Butler in Seven").
     */
    allowBareCardinal?: boolean;
  } = {},
): number | null {
  const t = lower(text);

  const patterns: RegExp[] = [
    /\bround (\d{1,2})\b/,
    /\bin the (\d{1,2})(?:st|nd|rd|th) round\b/,
    /\bin (\d{1,2})(?:st|nd|rd|th) round\b/,
    /\br(\d{1,2})\b/,
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 15) return n;
    }
  }

  // Worded rounds: "in the seventh", "in seven", "seventh round".
  const worded = new RegExp(`\\b(?:in the|in|the)\\s+(${Object.keys(ORDINALS).join("|")})\\b(?:\\s+round)?`).exec(t);
  if (worded) {
    const n = ORDINALS[worded[1]];
    // "in one" / "in two" are ambiguous English outside a round context, so a bare
    // cardinal only counts when "round" is present somewhere in the text.
    const cardinal = /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)$/.test(worded[1]);
    if (n && (!cardinal || /\bround/.test(t) || opts.allowBareCardinal)) return n;
  }
  const ordinalRound = new RegExp(`\\b(${Object.keys(ORDINALS).join("|")})\\s+round\\b`).exec(t);
  if (ordinalRound) return ORDINALS[ordinalRound[1]] ?? null;

  return null;
}

// ── the extractor ───────────────────────────────────────────────────────────

/**
 * Read an outcome for THIS bout out of this text, or return null.
 *
 * `text` should be the headline plus (optionally) a lead paragraph. Passing a whole
 * article body is allowed but weakens position-based winner detection, so the caller
 * should prefer headline + excerpt.
 */
export function extractOutcome(text: string, bout: Bout): Extraction | null {
  if (!text?.trim()) return null;
  const t = lower(text);
  const reasons: string[] = [];

  // 1. Refuse anything that is not asserting a completed result.
  if (isQuestion(text)) return null;
  const hedge = HEDGES.find((h) => t.includes(h));
  if (hedge) return null;

  // 2. Both fighters must be identifiable, and distinguishable from each other.
  const redKey = keyToken(bout.redName);
  const blueKey = keyToken(bout.blueName);
  if (!redKey || !blueKey || redKey === blueKey) return null;

  const redAt = indexOfToken(t, redKey);
  const blueAt = indexOfToken(t, blueKey);
  if (redAt < 0 || blueAt < 0) return null;
  reasons.push(`Both fighters named ("${redKey}", "${blueKey}")`);

  // 3. Draw / no contest short-circuit: there is no winner to position.
  if (NC_RE.test(t)) {
    return { outcome: "NO_CONTEST", winner: null, method: "NC", round: extractRound(t), quality: 0.7, reasons: [...reasons, "Text states a no contest"] };
  }
  if (DRAW_RE.test(t)) {
    return { outcome: "DRAW", winner: null, method: "DRAW", round: null, quality: 0.7, reasons: [...reasons, "Text states a draw"] };
  }

  // 4. Every win-assertion in the text, with where it sits.
  const matches = WIN_VERBS.flatMap((v) => {
    const m = v.re.exec(t);
    return m ? [{ method: v.method, subjectLoses: !!v.subjectLoses, at: m.index, end: m.index + m[0].length }] : [];
  });
  if (!matches.length) return null;

  // POSITION and METHOD are decided SEPARATELY, because conflating them was wrong in
  // both directions:
  //   · "Berlanga beats Butler by unanimous decision" — the generic "beats" comes
  //     first, so an earliest-match rule threw away the stated UD.
  //   · "Berlanga survives a knockdown to stop Butler" — the outcome verb is late,
  //     so a most-specific-match rule would anchor the winner in the wrong place.
  // The EARLIEST assertion orients the sentence; the MOST SPECIFIC one names the
  // method. WIN_VERBS is ordered by specificity, so `find` picks the best method.
  const anchor = matches.reduce((a, b) => (a.at <= b.at ? a : b));
  const method = matches.find((m) => m.method !== null)?.method ?? null;

  // 5. The fighter before the verb is its SUBJECT. In an active clause the subject
  //    won; in a passive one ("stopped by") the subject lost.
  const subject =
    redAt < anchor.at && blueAt > anchor.at ? "RED"
      : blueAt < anchor.at && redAt > anchor.at ? "BLUE"
        : null;
  if (!subject) {
    // Both names on the same side of the verb ("Berlanga and Butler both..."), which
    // is not a reading we can trust.
    return null;
  }

  // Either shape can put the loser first, and both invert the reading.
  const passive = PASSIVE_AFTER_VERB.test(t.slice(anchor.end));
  const inverted = passive || anchor.subjectLoses;
  const before: Corner = inverted ? (subject === "RED" ? "BLUE" : "RED") : subject;
  reasons.push(
    inverted
      ? `${subject === "RED" ? redKey : blueKey} named first but as the LOSER, so ${before === "RED" ? redKey : blueKey} won`
      : `${before === "RED" ? redKey : blueKey} named before the outcome verb`,
  );

  // A stoppage licenses the bare-cardinal round form ("stops him in seven"); a
  // decision does not, because "beats him in seven" is not a thing anyone writes.
  const isStoppage = !!method && ["KO", "TKO", "SUB", "RTD"].includes(method);
  const round = extractRound(t, { allowBareCardinal: isStoppage });
  if (method) reasons.push(`Method read as ${method}`);
  else reasons.push("Method not stated");
  if (round) reasons.push(`Round ${round}`);

  // 6. Quality: how COMPLETE this reading is. Not source reliability — the confidence
  //    engine combines the two.
  //
  //    Calibrated so a complete reading reaches ~1.0. The first scale topped out at
  //    0.8 for a perfect extraction, which quietly capped everything downstream: a
  //    major outlet became 0.75 × 0.8 = 0.6, two of them combined to 0.84, and the
  //    auto-publish bar is 0.85. Two unambiguous reports from ESPN and the BBC
  //    naming the same winner, method and round missed by 0.01 — so the queue filled
  //    with results no human would have questioned. Raising the ceiling is the honest
  //    fix; lowering the threshold would have made single weak sources cheaper too.
  let quality = 0.6;
  if (method) quality += 0.25;
  if (round) quality += 0.15;
  // A stoppage method with no round is slightly suspect: reports of stoppages almost
  // always say when.
  if (method && ["KO", "TKO", "SUB", "RTD"].includes(method) && !round) quality -= 0.1;
  // Decisions never have a round, so their absence is not a penalty.
  quality = Math.max(0.1, Math.min(1, quality));

  return { outcome: "WIN", winner: before, method, round, quality, reasons };
}
