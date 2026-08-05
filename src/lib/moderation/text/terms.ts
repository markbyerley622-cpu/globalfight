// ════════════════════════════════════════════════════════════════════════════
//  Deny-list terms, base64-encoded.
//
//  ── Why encoded ───────────────────────────────────────────────────────────
//  Not obfuscation-as-security — anyone can decode this in one line, and it is
//  meant to be readable by whoever maintains it. It is encoded because a source
//  file containing two dozen racial slurs in plain text is a liability of its
//  own: it lands in IDE search results, in code review, in `grep` output on a
//  shared screen, and in the training corpus of anything that indexes the repo.
//  Decoding at module load costs microseconds once.
//
//  ── Why the list is SMALL ─────────────────────────────────────────────────
//  A long list is a false-positive machine, and every false positive is a real
//  user being told their fight take is hate speech. This holds only terms whose
//  slur reading is unambiguous, and even then several carry contextual
//  exemptions in rules.ts ("chink in the armour" is ordinary fight commentary).
//
//  Profanity is NOT here and never should be. "This fight was fucking amazing"
//  and "he's getting knocked the fuck out" are how the audience for this
//  product talks. Moderating them would be moderating the community out.
//
//  ── Extending ─────────────────────────────────────────────────────────────
//  Add the base64 of the lower-case term. Prefer adding a contextual rule in
//  rules.ts over adding a term that has any innocent reading.
// ════════════════════════════════════════════════════════════════════════════

const decode = (list: string[]): string[] => list.map((t) => Buffer.from(t, "base64").toString("utf8"));

/** Racial and ethnic slurs. */
export const RACIAL = decode([
  "bmlnZ2Vy", "bmlnZ2E=", "bmlnZXI=", "Y29vbg==", "c3BpYw==", "d2V0YmFjaw==",
  "YmVhbmVy", "Z29vaw==", "Y2hpbms=", "a2lrZQ==", "cmFnaGVhZA==", "dG93ZWxoZWFk",
  "cGFraQ==", "Z3lwcG8=",
]);

/** Slurs targeting sexuality or gender identity. */
export const HOMOPHOBIC = decode(["ZmFnZ290", "ZmFnb3Q=", "dHJhbm55", "c2hlbWFsZQ=="]);

/** Slurs targeting disability. */
export const ABLEIST = decode(["cmV0YXJk", "cmV0YXJkZWQ="]);

/**
 * Innocent words that CONTAIN a deny-listed term as a substring.
 *
 * The collapsed-form check (which strips spacing, to catch "n i g g e r") has no
 * word boundaries, so without this "raccoon" and "cocoon" both hit the racial
 * list. This is the Scunthorpe problem, and the cost of getting it wrong is a
 * fan being accused of racism for typing "raccoon".
 */
export const INNOCENT_SUBSTRINGS = [
  "raccoon", "racoon", "cocoon", "tycoon", "lagoon", "spicy", "spice", "spices",
  "despicable", "japan", "japanese", "scrape", "grape", "therapist", "analysis",
  "assassin", "class", "bass", "pass", "mass", "glass", "brass", "grass",
];

/**
 * Contextual exemptions: a term is NOT a slur when it appears in these phrases.
 *
 * "A chink in the armour" is stock combat-sports commentary — it is in every
 * broadcast and every breakdown. Blocking it would be the single most visible
 * false positive this service could produce, on exactly the kind of post the
 * product wants.
 */
export const EXEMPT_PHRASES = [
  /chink\s+in\s+(the|his|her|their|that)\s+armou?r/,
  /chink\s+in\s+the\s+armou?r/,
];
