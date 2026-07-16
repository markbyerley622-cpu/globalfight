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
    .replace(/['’.]/g, "") // apostrophes & dots → nothing
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
