// ════════════════════════════════════════════════════════════════════════════
//  Text normalisation for moderation matching.
//
//  A deny-list that matches only exact spellings stops nobody: the first thing
//  anyone does is space it out, swap an `i` for a `1`, or paste it with a
//  zero-width joiner in the middle. Normalisation is what turns a list of ~20
//  terms into something that actually holds.
//
//  This is DELIBERATELY LOSSY and is used ONLY for matching. The stored comment
//  is always the user's original text — nothing here ever rewrites what someone
//  wrote.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Visually-confusable characters → the letter they stand in for.
 *
 * Only unambiguous substitutions. `l`→`i` is deliberately absent: it would turn
 * "hello" into "heiio" and break far more than it catches.
 */
const LEET: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g",
  "@": "a", "$": "s", "!": "i", "|": "i", "+": "t",
  "£": "e", "€": "e", "¢": "c",
};

/** Characters people wedge between letters to defeat a word match. */
const SEPARATORS = /[\s._\-*'"`~^()[\]{}<>\/\\,:;#%&=?]+/g;

/**
 * Invisible characters. Zero-width space/joiner/non-joiner and the BOM are the
 * classic way to smuggle a term past a substring check while it still renders
 * as the word to a human reader.
 */
const INVISIBLE = /[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g;

/**
 * The canonical form used for matching: lower-cased, accent-stripped,
 * leet-folded, with invisible characters removed.
 *
 * Separators are NOT removed here — that happens in `collapsed()`. Keeping the
 * two forms separate matters: the spaced form preserves word boundaries (so
 * "raccoon" cannot match "coon"), while the collapsed form is what catches
 * "n i g g e r". Rules that need boundaries use this one.
 */
export function normalize(input: string): string {
  return input
    .normalize("NFKD")               // decompose accents: é → e + ́
    .replace(/[\u0300-\u036F]/g, "") // strip the combining marks
    .replace(INVISIBLE, "")
    .toLowerCase()
    .replace(/[0-9@$!|+£€¢]/g, (c) => LEET[c] ?? c)
    // Three or more of the same letter collapse to two: "niiiigger" → "niigger",
    // while real doubles ("bullllshit" → "bullshit") survive intact.
    .replace(/(.)\1{2,}/g, "$1$1");
}

/**
 * Everything that is not a letter or digit, removed.
 *
 * This is the form that defeats "n-i-g-g-e-r" and "f a g g o t". It is only
 * ever used by rules that ALSO carry an allow-list, because collapsing destroys
 * word boundaries — "class icon" collapses to "classicon", and any rule reading
 * this form has to accept that a substring hit is a weaker signal.
 */
export function collapsed(input: string): string {
  return normalize(input).replace(SEPARATORS, "").replace(/[^a-z0-9]/g, "");
}

/** Word-boundary-safe tokens from the normalised text. */
export function tokens(input: string): string[] {
  return normalize(input).split(SEPARATORS).filter(Boolean);
}
