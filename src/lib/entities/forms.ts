// ════════════════════════════════════════════════════════════════════════════
//  Surface forms + match keys — the deterministic vocabulary of one entity.
//
//  PURE. No prisma, no server-only, no model. Every rule here is a stated
//  transform over strings, so every rule is unit-testable and every match is
//  explainable ("alias hit", "loose name hit", "transliteration hit").
//
//  TWO different jobs, deliberately separated:
//
//    forms(…)  → the strings that, appearing IN FREE TEXT, refer to this entity.
//                Headlines say "Joshua stops Prenga" and "AJ returns", so the
//                surface is wider than the canonical name.
//
//    keys(…)   → comparison keys for resolving an upstream NAME to this entity.
//                A provider sends "Anthony Oluwafemi Joshua" or "A. Joshua"; we
//                need to know that is the same row, not a new fighter.
//
//  Every form carries a TIER, and the tier is what keeps this honest:
//    canonical — unambiguous by construction (the full name)
//    strong    — used anywhere (surname, alias, nickname)
//    weak      — only legal inside a CLOSED candidate set (initials, acronyms,
//                transliteration folds). "AJ" is Anthony Joshua on an Anthony
//                Joshua card; in an open corpus it is noise. That distinction is
//                the whole reason weak forms can exist at all.
// ════════════════════════════════════════════════════════════════════════════

import { normalizeName, nameKey, looseKey } from "@/services/normalization/names";

export { normalizeName, nameKey, looseKey };

export type FormTier = "canonical" | "strong" | "weak";

export interface SurfaceForm {
  /** Normalized, space-separated. Compare against a normalized haystack. */
  form: string;
  tier: FormTier;
  /** Which rule produced it — carried through so a match can explain itself. */
  origin: FormOrigin;
}

export type FormOrigin =
  | "name"
  | "loose"
  | "surname"
  | "alias"
  | "nickname"
  | "initial"
  | "acronym";

export interface EntityNameInput {
  name: string;
  nickname?: string | null;
  /** Registry aliases (FighterAlias.alias) — alternate spellings, native forms. */
  aliases?: string[];
}

// A surname shorter than this is too collision-prone to carry a match on its
// own ("Li", "Kim", "Ali" inside "Alias"). The coverage query has always refused
// short terms for the same reason; this is that rule, named.
const MIN_SURNAME = 4;

/** Leading articles a nickname is written with but rarely referred to by. */
const NICKNAME_ARTICLE = /^(the|el|la|le|il|los|las)\s+/;

/**
 * Every string that, found in free text, refers to this entity — tiered.
 *
 * Deduped with the STRONGEST tier winning, so a nickname that happens to equal
 * the surname doesn't demote it.
 */
export function surfaceForms(input: EntityNameInput): SurfaceForm[] {
  const out = new Map<string, SurfaceForm>();
  const add = (form: string, tier: FormTier, origin: FormOrigin) => {
    const f = form.trim();
    // Nothing this short is evidence of anything — EXCEPT an acronym, which is
    // two characters by nature ("AJ", "CM"). That is safe only because acronyms
    // are weak-tier, so they never apply outside a closed candidate set.
    const floor = origin === "acronym" ? 2 : 3;
    if (f.length < floor) return;
    const prior = out.get(f);
    if (prior && TIER_RANK[prior.tier] <= TIER_RANK[tier]) return;
    out.set(f, { form: f, tier, origin });
  };

  const canonical = nameKey(input.name);
  if (canonical) add(canonical, "canonical", "name");

  const normalized = normalizeName(input.name);
  if (normalized && normalized !== canonical) add(normalized, "canonical", "name");

  const loose = looseKey(input.name);
  if (loose && loose !== canonical) add(loose, "strong", "loose");

  const tokens = canonical.split(" ").filter(Boolean);
  const surname = tokens[tokens.length - 1] ?? "";
  if (surname.length >= MIN_SURNAME) add(surname, "strong", "surname");

  // "A. Joshua" normalizes to "a joshua" — an initialled form is real in print
  // but far too thin to stand alone in an open corpus.
  if (tokens.length >= 2 && surname.length >= MIN_SURNAME) {
    add(`${tokens[0][0]} ${surname}`, "weak", "initial");
  }

  // "AJ", "GSP", "KSW" — how fans write a fighter, and unusable outside a
  // closed set.
  const acronym = acronymOf(canonical);
  if (acronym) add(acronym, "weak", "acronym");

  if (input.nickname) {
    const nick = nameKey(input.nickname);
    if (nick) {
      add(nick, "strong", "nickname");
      const bare = nick.replace(NICKNAME_ARTICLE, "");
      if (bare && bare !== nick) add(bare, "strong", "nickname");
    }
  }

  for (const alias of input.aliases ?? []) {
    const a = nameKey(alias);
    if (!a) continue;
    add(a, "strong", "alias");
    const al = looseKey(alias);
    if (al && al !== a) add(al, "strong", "alias");
  }

  return [...out.values()].sort(
    (a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.form.length - a.form.length,
  );
}

const TIER_RANK: Record<FormTier, number> = { canonical: 0, strong: 1, weak: 2 };

/** Initials of a 2–3 token name: "anthony joshua" → "aj". Null otherwise. */
export function acronymOf(canonicalName: string): string | null {
  const tokens = canonicalName.split(" ").filter(Boolean);
  if (tokens.length < 2 || tokens.length > 3) return null;
  return tokens.map((t) => t[0]).join("");
}

// ── Transliteration folding ────────────────────────────────────────────────
// Romanizations of the same Cyrillic / Arabic / Thai name disagree in a small,
// KNOWN set of ways. Each substitution below is an orthographic equivalence
// between two spellings of the SAME sound — never a different name:
//
//   Aleksandr / Alexandr     ks ↔ x
//   Vladimir  / Wladimir     v  ↔ w
//   Yusuf     / Jusuf        y  ↔ j
//   Dmitri    / Dmitrii / Dmitry
//   Muhammad  / Muhamad      doubled consonants
//   Khabib    / Kabib        kh ↔ k
//
// This is a low-tier signal on purpose. A fold is only ever ACCEPTED when it is
// unique among the candidates (see resolve.ts) — never as a broad sweep.
const TRANSLIT: [RegExp, string][] = [
  [/x/g, "ks"],
  [/ph/g, "f"],
  [/kh/g, "k"],
  [/gh/g, "g"],
  [/w/g, "v"],
  [/[jy]/g, "i"],
  [/ou/g, "u"],
  [/(.)\1+/g, "$1"], // collapse doubles LAST, after the rules above create some
];

/** Spelling-agnostic key. Same key ⇒ the two spellings are romanization variants. */
export function translitKey(raw: string): string {
  let s = nameKey(raw);
  for (const [re, to] of TRANSLIT) s = s.replace(re, to);
  return s.replace(/\s+/g, " ").trim();
}

export interface MatchKeys {
  /** Suffix-stripped normalized full name. */
  canonical: string;
  /** First + last token only. */
  loose: string;
  /** Romanization-folded canonical. */
  translit: string;
  /** Last token of the canonical name. */
  surname: string;
  /** Number of name tokens — a guard on the weak tiers. */
  tokenCount: number;
  /** Alias + nickname keys, canonical and loose. */
  aliasKeys: string[];
  nicknameKeys: string[];
  acronym: string | null;
  /** "a joshua" */
  initialSurname: string | null;
}

/** The comparison keys used to decide whether an upstream name IS this entity. */
export function matchKeys(input: EntityNameInput): MatchKeys {
  const canonical = nameKey(input.name);
  const tokens = canonical.split(" ").filter(Boolean);
  const surname = tokens[tokens.length - 1] ?? "";

  const aliasKeys = new Set<string>();
  for (const alias of input.aliases ?? []) {
    const a = nameKey(alias);
    if (a) aliasKeys.add(a);
    const al = looseKey(alias);
    if (al) aliasKeys.add(al);
  }

  const nicknameKeys = new Set<string>();
  if (input.nickname) {
    const nick = nameKey(input.nickname);
    if (nick) {
      nicknameKeys.add(nick);
      const bare = nick.replace(NICKNAME_ARTICLE, "");
      if (bare) nicknameKeys.add(bare);
    }
  }

  return {
    canonical,
    loose: looseKey(input.name),
    translit: translitKey(input.name),
    surname,
    tokenCount: tokens.length,
    aliasKeys: [...aliasKeys],
    nicknameKeys: [...nicknameKeys],
    acronym: acronymOf(canonical),
    initialSurname:
      tokens.length >= 2 && surname.length >= MIN_SURNAME ? `${tokens[0][0]} ${surname}` : null,
  };
}

/**
 * Haystack prepared for form matching: normalized and space-padded, so testing
 * ` form ` gives word-boundary semantics for single AND multi-word forms without
 * building a regex per form.
 */
export function haystack(text: string): string {
  return ` ${normalizeName(text)} `;
}

/** Does this prepared haystack contain the form as whole word(s)? */
export function haystackHas(prepared: string, form: string): boolean {
  return prepared.includes(` ${form} `);
}

export const MIN_SURNAME_LENGTH = MIN_SURNAME;
