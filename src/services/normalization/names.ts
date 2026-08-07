// Name normalization for identity matching. The goal: collapse the many ways a
// fighter's name appears across sources to one comparable key.
//
//   "Israel Mobolaji Adesanya" → "israel adesanya"
//   "I. Adesanya"              → "i adesanya"   (initials kept; see looseKey)
//   "José Aldo Jr."           → "jose aldo"

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** Lowercase, strip diacritics, drop punctuation, collapse whitespace. */
export function normalizeName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // diacritics
    .toLowerCase()
    // ── A dot BETWEEN letters is a separator, not punctuation to delete ─────
    //
    // Dots and apostrophes used to be deleted together, and for apostrophes
    // that is right — "O'Malley" and "OMalley" are the same name and should
    // fold to one key.
    //
    // For a dot it depends entirely on position, and getting it wrong cost real
    // duplicates. The ONE backfill imported "Numsurin Chor.Ketwina" while the
    // registry held "Numsurin Chor Ketwina"; deleting the dot produced
    // "chorketwina" — ONE token where the other name has two — so the two never
    // compared equal at any rung, two fighters existed, and the same bout was
    // written twice. Thai ring names are written with these dots constantly
    // ("Tor.Pran49", "Sor.Sommai"), so this was not one unlucky row.
    //
    // A dot after at least TWO characters, followed by a letter → separator.
    //
    // The two-character floor is what keeps initials working. "A.J. Smith" has
    // a single letter before its dot, which is an INITIAL marker, and splitting
    // there would give "a j smith" where the registry has "aj smith" — trading
    // one class of duplicate for another. Caught by checking before shipping;
    // "Chor.Ketwina" has "or" before its dot and still splits.
    .replace(/(?<=[a-z0-9]{2})\.(?=[a-z])/g, " ")
    .replace(/['’.]/g, "") // apostrophes & remaining dots → nothing
    .replace(/[^a-z0-9\s-]/g, " ") // other punctuation → space
    .replace(/\s+/g, " ")
    .trim();
}

/** Canonical key: normalized, with name suffixes (Jr/III/…) removed. */
export function nameKey(raw: string): string {
  const tokens = normalizeName(raw).split(" ").filter((t) => t && !SUFFIXES.has(t));
  return tokens.join(" ");
}

// ── DISPLAY casing ──────────────────────────────────────────────────────────
// Everything above is for MATCHING and is deliberately lossy. This is the other
// direction: what a name should look like when it is shown to somebody.
//
// Sanctioning bodies publish ratings tables in caps. The WBA men's connector
// created 206 fighters in one run, every one of them stored as "MURAT GASSIEV",
// sitting on the rankings board next to "Dmitry Bivol" — who was only spelled
// properly because he already existed. The registry has no way to recover the
// casing later, so it has to be done at the point of creation.
//
// Matching is unaffected: nameKey() lowercases anyway, so this changes the
// display string and nothing about identity.

/** Suffixes that stay upper-case, and the ones that get title-cased. */
const ROMAN = new Set(["II", "III", "IV", "V", "VI"]);
const LOWER_PARTICLES = new Set(["de", "del", "da", "di", "van", "von", "der", "den", "la", "le", "dos", "das", "bin", "al"]);

function caseWord(word: string, index: number): string {
  if (!word) return word;
  const upper = word.toUpperCase();
  if (ROMAN.has(upper)) return upper;
  // A lone letter is an initial ("ABRAHAM R PEREZ"), not a word to title-case.
  if (word.length === 1) return upper;

  // Hyphens and apostrophes join two words that BOTH get capitalised —
  // "BILLAM-SMITH" → "Billam-Smith", "O'SULLIVAN" → "O'Sullivan".
  if (/[-'’]/.test(word)) {
    return word.split(/([-'’])/).map((part, i) => (/[-'’]/.test(part) ? part : caseWord(part, i === 0 ? index : 1))).join("");
  }

  const lower = word.toLowerCase();
  // Particles stay lower-case unless they lead the name ("Oscar de la Hoya",
  // but "De La Hoya" if that is the whole surname at the front).
  if (index > 0 && LOWER_PARTICLES.has(lower)) return lower;

  // "MCGREGOR" → "McGregor". Restricted to Mc: Mac is a real prefix but also
  // the start of ordinary names ("MACIEL"), and "MacIel" is worse than "Maciel".
  if (/^mc[a-z]{2,}$/.test(lower)) return `Mc${lower[2].toUpperCase()}${lower.slice(3)}`;

  return lower[0].toUpperCase() + lower.slice(1);
}

/**
 * Format a name for display, but ONLY when the source shouted it.
 *
 * A string containing any lower-case letter is left exactly as it is — it was
 * written by someone who made a casing decision, and overriding that would
 * flatten "Conor McGregor" and every deliberately-styled ring name in the
 * registry. This only rescues the all-caps case, where no information is lost
 * because there was none to begin with.
 */
export function displayName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed || /[a-z]/.test(trimmed)) return trimmed;
  return trimmed.split(" ").map(caseWord).join(" ");
}

/**
 * Loose key for fuzzy matching: first + last token only, middle names dropped.
 * Lets "Israel Mobolaji Adesanya" match "Israel Adesanya". Single-token names
 * pass through unchanged.
 */
export function looseKey(raw: string): string {
  const tokens = nameKey(raw).split(" ").filter(Boolean);
  if (tokens.length <= 1) return tokens.join(" ");
  return `${tokens[0]} ${tokens[tokens.length - 1]}`;
}
