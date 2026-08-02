// ════════════════════════════════════════════════════════════════════════
//  HTML-entity decoding + text normalization — the single normalizer for any
//  externally-sourced text (RSS titles/excerpts, scraped names, …).
//
//  WHY THIS EXISTS. The old inline decoder in news/ingest.ts decoded entities in
//  ONE fixed-order pass. Google News (and many CMSs) DOUBLE-ENCODE: they send
//  `it&amp;#8217;s`, not `it&#8217;s`. A single pass expands `&amp;`->`&` LAST,
//  after the numeric pass already ran, so it reveals a fresh `&#8217;` that never
//  gets decoded again — and that residue (`&#8217;`, `&quot;`, `&amp;`) is exactly
//  what ended up stored in 41 article titles.
//
//  The fix is to decode to a FIXPOINT: keep decoding until the string stops
//  changing (bounded, so a pathological input can't loop). This resolves any
//  depth of encoding. Normalize ONCE here, store the clean value, and never
//  decode again downstream (no render-time or client-side hacks).
// ════════════════════════════════════════════════════════════════════════

// Named entities that actually occur in combat-sports headlines and publisher
// feeds. Numeric/hex forms are handled generically below, so this only needs the
// NAMED aliases (punctuation, spaces, symbols, common accented letters).
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  // Curly quotes / primes — the #1 source of the bug.
  lsquo: "‘", rsquo: "’", sbquo: "‚",
  ldquo: "“", rdquo: "”", bdquo: "„",
  lsaquo: "‹", rsaquo: "›", laquo: "«", raquo: "»",
  prime: "′", Prime: "″",
  // Dashes / ellipsis / bullets.
  ndash: "–", mdash: "—", minus: "−", hellip: "…",
  bull: "•", middot: "·",
  // Symbols.
  copy: "©", reg: "®", trade: "™", deg: "°",
  eacute: "é", egrave: "è", agrave: "à", ccedil: "ç",
  ntilde: "ñ", uuml: "ü", ouml: "ö", auml: "ä",
  szlig: "ß", oslash: "ø", aring: "å", aelig: "æ",
  Eacute: "É", Ntilde: "Ñ", euro: "€", pound: "£",
  cent: "¢", yen: "¥", times: "×", divide: "÷",
  frac12: "½", frac14: "¼", frac34: "¾",
};

// A single decode pass: hex, then decimal, then named. Invalid/dangerous
// codepoints are dropped rather than throwing.
function decodeOnce(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => fromCodePoint(parseInt(h, 16), m))
    .replace(/&#(\d+);/g, (m, n) => fromCodePoint(Number(n), m))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, name) => {
      const v = NAMED[name] ?? NAMED[name.toLowerCase()];
      return v ?? m; // unknown named entity: leave untouched
    });
}

// Guard against invalid or unsafe code points (out of range, surrogates, NUL).
// On failure keep the original entity text rather than corrupting the string.
function fromCodePoint(cp: number, original: string): string {
  if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) return original;
  if (cp >= 0xd800 && cp <= 0xdfff) return original; // lone surrogate
  try {
    return String.fromCodePoint(cp);
  } catch {
    return original;
  }
}

/**
 * Fully decode HTML entities, including DOUBLE/TRIPLE-encoded input, by decoding
 * to a fixpoint. Bounded to a few passes so a crafted input can never loop.
 *
 * Idempotent on already-clean text: a string with no `&…;` sequence is returned
 * unchanged on the first pass and the loop exits immediately — so it is safe to
 * run repeatedly (e.g. a resumable backfill).
 */
export function decodeHtmlEntities(input: string): string {
  if (typeof input !== "string" || input.length === 0 || !input.includes("&")) {
    return input;
  }
  let out = input;
  // 4 passes resolves quadruple-encoding — far beyond anything seen in the wild.
  for (let i = 0; i < 4; i++) {
    const next = decodeOnce(out);
    if (next === out) break; // fixpoint reached
    out = next;
  }
  return out;
}

// Invisible / unsafe characters that must never reach storage or render: C0/C1
// controls (except \t \n \r, which whitespace-collapse handles), zero-width
// spaces/joiners, bidi overrides, word-joiner and BOM. Built from an escaped
// STRING via the RegExp constructor so this source file stays plain-ASCII and
// the character class can never be silently corrupted by an editor.
const CONTROL_CHARS = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F" +
    "\\u200B-\\u200F\\u202A-\\u202E\\u2060\\uFEFF]",
  "g",
);

/**
 * Normalize externally-sourced display text: decode entities to a fixpoint,
 * remove invisible/control characters, collapse whitespace, and trim. This is
 * the one function every ingestion path should run before storing a title,
 * excerpt, name, or similar human-facing string.
 */
export function normalizeText(input: string): string {
  if (typeof input !== "string" || input.length === 0) return "";
  return decodeHtmlEntities(input)
    .replace(CONTROL_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when a string still contains an HTML entity (named, decimal, or hex).
 * Used by the data-quality audit + backfill to find affected rows cheaply.
 */
export function hasHtmlEntity(input: string): boolean {
  return typeof input === "string" && /&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.test(input);
}

// ════════════════════════════════════════════════════════════════════════
//  canonicalizeTitle — the MATCHING key. Never stored, never displayed.
//
//  normalizeText above produces the value we STORE: the title as a human
//  should read it, entities resolved. This produces the value we MATCH on,
//  and the two must not be confused — folding case and punctuation is right
//  for deciding "is this the same card?" and wrong for showing someone a name.
//
//  ── THE BUG THIS EXISTS TO PREVENT ──────────────────────────────────────
//
//  ONE's extractor hand-rolled `.replace(/&amp;/g, "&")`, which handles one
//  entity out of the three its JSON-LD emits. Eight cards were stored as
//  "Kings &#038; Champions" and slugged `kings-038-champions`, while the SAME
//  cards arrived from Wikipedia correctly named. Deduplication compared an
//  encoded string with a decoded one, correctly concluded they differed, and
//  wrote a second row per card — the encoded copy empty, the decoded one
//  holding all ten bouts.
//
//  The rule that follows: NEVER compare two externally-sourced titles without
//  canonicalizing both, and canonicalize before hashing or deriving an id.
// ════════════════════════════════════════════════════════════════════════

// Typographic variants that mean the same character to a reader.
//
// Built from ESCAPED strings via the RegExp constructor, for the same reason
// CONTROL_CHARS above is: it keeps this file plain-ASCII, so an editor, a diff
// or a re-encode can never silently corrupt a class made of invisible and
// look-alike characters. (Writing the space class literally also trips
// no-irregular-whitespace.)
const PUNCT_FOLD: Array<[RegExp, string]> = [
  // Smart quotes / primes -> ASCII apostrophe.
  [new RegExp("[\\u2018\\u2019\\u201A\\u201B\\u2032]", "g"), "'"],
  // Smart double quotes / double prime -> ASCII quote.
  [new RegExp("[\\u201C\\u201D\\u201E\\u201F\\u2033]", "g"), '"'],
  // Every dash-like character -> hyphen. "Fight Night <emdash> Smith" and
  // "Fight Night - Smith" are one card billed by two sources.
  [new RegExp("[\\u2010-\\u2015\\u2212\\u2043]", "g"), "-"],
  // Ellipsis -> three dots, so punctuation stripping treats it consistently.
  [new RegExp("\\u2026", "g"), "..."],
  // Non-breaking, en/em, thin, narrow and ideographic spaces -> plain space.
  [new RegExp("[\\u00A0\\u2000-\\u200A\\u202F\\u205F\\u3000]", "g"), " "],
];

/**
 * The canonical form of a title, for MATCHING and hashing only.
 *
 * Order is deliberate:
 *   1. decode entities to a fixpoint — otherwise every later step operates on
 *      `&#038;` rather than on `&`, which is the whole bug;
 *   2. NFKC — composed vs decomposed accents, and full-width characters,
 *      compare equal;
 *   3. fold typographic punctuation to ASCII;
 *   4. `&` -> " and ", because sources genuinely disagree on this one
 *      ("Kings & Champions" vs "Kings and Champions") and it is the exact
 *      collision in the data;
 *   5. lowercase, strip remaining punctuation, collapse whitespace.
 *
 * Returns "" for empty input. NOT reversible, NOT for display or storage.
 */
export function canonicalizeTitle(input: string | null | undefined): string {
  if (typeof input !== "string" || input.length === 0) return "";

  let out = decodeHtmlEntities(input).normalize("NFKC").replace(CONTROL_CHARS, "");
  for (const [re, to] of PUNCT_FOLD) out = out.replace(re, to);

  return out
    .toLowerCase()
    // "&" and "and" are the same word to a reader and to a promoter.
    .replace(/\s*&\s*/g, " and ")
    // Anything that is not a letter or number becomes a space, so
    // "UFC 300: Pereira vs. Hill" and "UFC 300 - Pereira vs Hill" agree.
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Do two externally-sourced titles refer to the same thing?
 *
 * Always use this rather than `a === b` on raw source strings — that
 * comparison is what let an encoded and a decoded copy of one card coexist.
 */
export function sameTitle(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = canonicalizeTitle(a);
  return ca.length > 0 && ca === canonicalizeTitle(b);
}
