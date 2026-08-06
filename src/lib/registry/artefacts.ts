// ════════════════════════════════════════════════════════════════════════════
//  PARSER ARTEFACT DETECTION — pure. No database, no I/O.
//
//  ── The bug this closes ──────────────────────────────────────────────────
//  audit:champions surfaced two WBA "titleholders":
//
//      INT. CHAMP:
//      IVANA HABAZIN *
//
//  Neither is a person. The first is a table LABEL the parser read as a name;
//  the second is a real name with a footnote marker welded on. Both went through
//  the identity resolver, matched nothing (correctly — no such fighter exists),
//  and were created as canonical Fighter rows. They then held a world title.
//
//  ── Why this belongs BEFORE identity, not after ──────────────────────────
//  The resolver's job is "which fighter is this?", and it answered correctly:
//  none. It has no business also deciding whether the string is a person at all
//  — that is a property of the TEXT, knowable without any database, and cheapest
//  to check at the point the parser hands the string over.
//
//  "IVANA HABAZIN *" is the more interesting case, and it is why this returns a
//  CLEANED form rather than a boolean: the name is real and recoverable, and
//  throwing the row away would lose a genuine champion to a stray asterisk.
//  Junk is refused; noise is cleaned.
// ════════════════════════════════════════════════════════════════════════════

export type ArtefactKind =
  /** A table label, not a person: "INT. CHAMP:", "CHAMPION", "VACANT". */
  | "label"
  /** Nothing but punctuation, digits or whitespace. */
  | "not_a_name"
  /** Too short to be anybody. */
  | "too_short"
  /** A footnote marker or bracketed note was attached — recoverable. */
  | "annotated";

export interface ArtefactVerdict {
  /** Safe to use as a fighter name? */
  ok: boolean;
  /** The name with recoverable noise stripped. Empty when `ok` is false. */
  cleaned: string;
  kind?: ArtefactKind;
  /** Why, for the review queue. */
  reason?: string;
}

/**
 * Strings that are LABELS on a ratings table, never people.
 *
 * Anchored and matched against the whole cleaned string, never as a substring:
 * "Champion" is junk on its own and is also a legitimate surname fragment
 * ("Championne"), so a substring test would refuse real names.
 */
const LABELS = [
  /^int(er(im)?)?\.?\s*champ(ion)?:?$/i,
  /^(wba|wbc|wbo|ibf|ibo|ubo)?\s*(world|regional|inter[- ]?continental|gold|silver|international)?\s*champion:?$/i,
  /^(vacant|not rated|unrated|n\/?a|tbd|tba|none|pending|--?)$/i,
  /^(rank|rating|position|no\.?|pos\.?)$/i,
  /^(champion|challenger|contender|titlist)s?:?$/i,
  /^(men'?s|women'?s)?\s*(division|weight ?class|category)$/i,
];

/**
 * Trailing footnote markers a ratings page hangs off a name.
 *
 * `*`, `**`, `†`, `(1)`, `[a]`, and the "- champion" suffix some tables append.
 * Stripped, not refused: the name in front of them is real.
 */
const ANNOTATION = /\s*(?:[*†‡#]+|\((?:\d+|[a-z])\)|\[[^\]]{1,12}\]|-\s*(?:champion|champ|interim|vacant))\s*$/i;

/** Leading rank or bullet debris: "1. ", "#3 ", "- ". */
const LEADING_NOISE = /^\s*(?:#?\d{1,3}[.)]?\s+|[-–—•]\s+)/;

const MIN_NAME = 3;

/**
 * Is this string a usable fighter name, and what is the usable form?
 *
 * Order matters: strip the noise FIRST, then judge what is left. "1. IVANA
 * HABAZIN *" is a real fighter behind two pieces of debris, and judging before
 * cleaning would refuse them.
 */
export function inspectName(raw: string): ArtefactVerdict {
  const collapsed = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!collapsed) return { ok: false, cleaned: "", kind: "not_a_name", reason: "empty" };

  let cleaned = collapsed.replace(LEADING_NOISE, "");
  const annotated = ANNOTATION.test(cleaned);
  // Repeatedly, because a table can stack them: "NAME * (1)".
  while (ANNOTATION.test(cleaned)) cleaned = cleaned.replace(ANNOTATION, "");
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  if (!cleaned) {
    return { ok: false, cleaned: "", kind: "not_a_name", reason: `"${collapsed}" is punctuation only` };
  }
  for (const label of LABELS) {
    if (label.test(cleaned)) {
      return { ok: false, cleaned: "", kind: "label", reason: `"${collapsed}" is a table label, not a person` };
    }
  }
  // A name needs letters. "12", ":", "—" are not people, and a string that is
  // only digits and punctuation cannot be anybody's name in any script.
  if (!/\p{L}/u.test(cleaned)) {
    return { ok: false, cleaned: "", kind: "not_a_name", reason: `"${collapsed}" contains no letters` };
  }
  if (cleaned.length < MIN_NAME) {
    return { ok: false, cleaned: "", kind: "too_short", reason: `"${collapsed}" is too short to be a name` };
  }
  // A trailing colon that survived the label check is still a label ("CHAMP:").
  if (cleaned.endsWith(":")) {
    return { ok: false, cleaned: "", kind: "label", reason: `"${collapsed}" ends in a colon — a table label` };
  }

  return annotated || cleaned !== collapsed
    ? { ok: true, cleaned, kind: "annotated", reason: `cleaned from "${collapsed}"` }
    : { ok: true, cleaned };
}

/** Convenience: the usable name, or null. */
export const usableName = (raw: string): string | null => {
  const v = inspectName(raw);
  return v.ok ? v.cleaned : null;
};
