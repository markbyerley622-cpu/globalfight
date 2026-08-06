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
