// ════════════════════════════════════════════════════════════════════════════
//  Entity Resolution — registry-first, deterministic, explainable.
//
//  PURE. Resolution happens against a CANDIDATE SET the caller supplies; this
//  module never reads a database (registry.ts does that). That split is what
//  makes every rule below testable and every verdict reproducible.
//
//  THE RULE THIS LAYER EXISTS TO ENFORCE:
//    prefer a canonical registry id; fall back to deterministic text matching
//    ONLY when no canonical entity can be resolved — and say which happened.
//
//  Two operations, both deterministic:
//
//    resolveName(query, candidates)  — "which registry entity is this string?"
//                                      A ladder of exact-key comparisons, and a
//                                      tie at the winning rung is AMBIGUOUS, not
//                                      a coin flip.
//
//    mentionOf(entity, text)         — "does this text name this entity?"
//                                      Word-boundary form matching, tier-gated.
//
//  No model. No embedding. No similarity threshold to tune. A match is an exact
//  comparison of two derived keys, and the key that matched is reported back.
// ════════════════════════════════════════════════════════════════════════════

import {
  surfaceForms,
  matchKeys,
  haystack,
  haystackHas,
  type EntityNameInput,
  type MatchKeys,
  type SurfaceForm,
  type FormTier,
} from "@/lib/entities/forms";

export type EntityKind = "fighter" | "promotion" | "venue";

/** How an entity was arrived at, strongest first. Carried into the UI-facing object. */
export type ResolutionVia =
  | "registry_id" // we already held the canonical row (the event-card case)
  | "external_id" // a linked (source, externalId)
  | "alias" // registry alias hit
  | "name_exact"
  | "nickname"
  | "name_loose"
  | "paternal" // "Ricardo Salas" for "Ricardo Salas Rodríguez" — maternal surname dropped
  | "initial" // "A. Joshua"
  | "translit" // romanization variant
  | "acronym" // "AJ"
  | "text_only"; // NO canonical entity exists — deterministic text fallback

/** A canonical entity plus the full surface needed to match text against it. */
export interface ResolvedEntity {
  kind: EntityKind;
  /** Registry id. Null ONLY when `via` is "text_only" — nothing canonical exists. */
  id: string | null;
  /** Stable url key (fighter slug, promotion slug, venue key), when there is one. */
  slug: string | null;
  /** The REGISTRY's display name — not the raw upstream string. */
  name: string;
  via: ResolutionVia;
  /** 0..1. A stated constant per rung of the ladder, never a tuned score. */
  confidence: number;
  /** The strings that refer to this entity in free text. */
  forms: SurfaceForm[];
  /** Comparison keys for resolving an upstream name to this entity. */
  keys: MatchKeys;
}

/**
 * The resolved entity view of one event — the shape EventEnrichment carries and
 * every downstream matcher (coverage, video, search, related fighters) consumes
 * instead of re-deriving names. Declared here, in the PURE module, so a
 * unit-testable consumer never has to reach across the server-only boundary for
 * the type. registry.ts is what populates it.
 */
export interface EventEntities {
  /** Every fighter on the card, canonical. */
  fighters: ResolvedEntity[];
  /** The headline bout's two corners — the strongest relevance signal there is. */
  main: { red: ResolvedEntity; blue: ResolvedEntity } | null;
  /** The promotion, or null when the event is genuinely unattributed ("Various"). */
  promotion: ResolvedEntity | null;
  venue: ResolvedEntity | null;
  /** How many fighters came back with a canonical registry id (vs text only). */
  canonicalFighterCount: number;
}

/** Confidence per rung. Constants, so two runs of the same input never differ. */
export const VIA_CONFIDENCE: Record<ResolutionVia, number> = {
  registry_id: 1,
  external_id: 1,
  name_exact: 0.98,
  alias: 0.95,
  nickname: 0.9,
  name_loose: 0.8,
  // Deliberately below OPEN_SET_FLOOR: dropping a surname is a legitimate short
  // form, but only safe to assume inside a bounded candidate set.
  paternal: 0.7,
  initial: 0.62,
  translit: 0.58,
  acronym: 0.5,
  text_only: 0.3,
};

/**
 * Below this, a match is only legal inside a CLOSED candidate set — the fighters
 * on one card, the promotions in one registry. "AJ" resolves on an Anthony
 * Joshua card; against the whole fighter table it is noise, and this constant is
 * what stops it from ever being used that way.
 */
export const OPEN_SET_FLOOR = VIA_CONFIDENCE.name_loose;

export interface ResolveOpts {
  /**
   * True when candidates are the entire universe (a global search). Weak rungs
   * (initial / translit / acronym) are refused. Default false: the caller passed
   * a bounded, contextual set.
   */
  openSet?: boolean;
}

export type NameResolution =
  | { ok: true; entity: ResolvedEntity; via: ResolutionVia; confidence: number }
  | { ok: false; reason: "no_match" | "ambiguous"; tied: ResolvedEntity[] };

/** Build the matchable candidate for a registry row we already hold. */
export function candidate(
  kind: EntityKind,
  row: { id: string | null; slug: string | null } & EntityNameInput,
  via: ResolutionVia = "registry_id",
): ResolvedEntity {
  return {
    kind,
    id: row.id,
    slug: row.slug,
    name: row.name,
    via,
    confidence: VIA_CONFIDENCE[via],
    forms: surfaceForms(row),
    keys: matchKeys(row),
  };
}

/**
 * A text-only entity: NO canonical registry row exists, so we carry the string
 * and say so. This is the explicit fallback the architecture allows — it is
 * never silent, because `via` is "text_only" and consumers can refuse it.
 */
export function textOnly(kind: EntityKind, name: string): ResolvedEntity {
  return {
    kind,
    id: null,
    slug: null,
    name,
    via: "text_only",
    confidence: VIA_CONFIDENCE.text_only,
    forms: surfaceForms({ name }),
    keys: matchKeys({ name }),
  };
}

// The ladder, strongest rung first. Each rung is an exact comparison of two
// derived keys — evaluated in order, and the first rung with any hit decides.
const LADDER: { via: ResolutionVia; hit: (q: MatchKeys, c: MatchKeys) => boolean }[] = [
  { via: "name_exact", hit: (q, c) => !!q.canonical && q.canonical === c.canonical },
  { via: "alias", hit: (q, c) => !!q.canonical && c.aliasKeys.includes(q.canonical) },
  { via: "nickname", hit: (q, c) => !!q.canonical && c.nicknameKeys.includes(q.canonical) },
  { via: "name_loose", hit: (q, c) => !!q.loose && q.loose === c.loose },
  { via: "paternal", hit: (q, c) => droppedSurname(q, c) || droppedSurname(c, q) },
  {
    via: "initial",
    hit: (q, c) => !!q.initialSurname && q.initialSurname === c.initialSurname,
  },
  {
    // Guarded: a romanization fold only counts when the two names have the same
    // shape and a substantial surname. Without these guards the fold is a blunt
    // instrument that collapses short unrelated names together.
    via: "translit",
    hit: (q, c) =>
      !!q.translit &&
      q.translit === c.translit &&
      q.tokenCount === c.tokenCount &&
      c.surname.length >= 4,
  },
  {
    // Both directions: "A.J." arrives as two tokens (an acronym in its own
    // right), while "AJ" arrives as one — and a bare 2–3 letter token IS how a
    // fan writes it, so it has to compare against the candidate's acronym too.
    via: "acronym",
    hit: (q, c) =>
      !!c.acronym &&
      ((!!q.acronym && q.acronym === c.acronym) ||
        (q.tokenCount === 1 && q.canonical.length <= 3 && q.canonical === c.acronym)),
  },
];

/**
 * Is `short` the same name as `full` with ONE trailing surname dropped?
 *
 * The Spanish/Portuguese two-surname case, and it was costing us real results.
 * "Ricardo Salas Rodríguez" is given name + paternal surname + maternal surname;
 * the everyday short form drops the maternal one, giving "Ricardo Salas". No rung
 * on the ladder could see that: `canonical` differs, and `loose` is first + LAST
 * token, so ours folded to "ricardo rodriguez" against the source's "ricardo
 * salas" — the surnames compared were different words.
 *
 * Observed in production: Wikipedia's record table for Richardson Hitchins held the
 * 2026-07-27 bout against "Ricardo Salas", we had "Ricardo Salas Rodriguez", the
 * bout failed to verify, and the event reported no available result while the source
 * plainly had one.
 *
 * Kept deliberately tight, because loosening name matching is how a pipeline starts
 * writing one fighter's result onto another:
 *   • exactly ONE extra token — two surnames, not an arbitrary prefix;
 *   • at least two tokens in the short form (a bare surname is never enough);
 *   • the retained surname must be ≥4 characters, so short particles like "Da" or
 *     "Los" cannot carry a match on their own.
 *
 * Two candidates sharing the same prefix ("Ricardo Salas Rodríguez" and "Ricardo
 * Salas Pérez") both hit this rung, which the ladder reports as `ambiguous` rather
 * than guessing — and in the wikicard path BOTH corners of a bout must resolve to the
 * same expected pair before anything is written.
 */
function droppedSurname(short: MatchKeys, full: MatchKeys): boolean {
  if (short.tokenCount < 2) return false;
  if (full.tokenCount !== short.tokenCount + 1) return false;
  if (short.surname.length < 4) return false;
  return full.canonical.startsWith(`${short.canonical} `);
}

/**
 * Resolve a raw name to one of `candidates`.
 *
 * Walks the ladder from strongest rung down. The first rung with any hit wins —
 * and if TWO candidates hit that same rung, the answer is `ambiguous`, not a
 * guess. That is the difference between deterministic matching and fuzzy
 * matching that happens to be right most of the time.
 */
export function resolveName(
  query: string,
  candidates: ResolvedEntity[],
  opts: ResolveOpts = {},
): NameResolution {
  const q = matchKeys({ name: query });
  if (!q.canonical) return { ok: false, reason: "no_match", tied: [] };

  for (const rung of LADDER) {
    if (opts.openSet && VIA_CONFIDENCE[rung.via] < OPEN_SET_FLOOR) break;
    const hits = candidates.filter((c) => rung.hit(q, c.keys));
    if (hits.length === 1) {
      return {
        ok: true,
        entity: { ...hits[0], via: rung.via, confidence: VIA_CONFIDENCE[rung.via] },
        via: rung.via,
        confidence: VIA_CONFIDENCE[rung.via],
      };
    }
    if (hits.length > 1) return { ok: false, reason: "ambiguous", tied: hits };
  }
  return { ok: false, reason: "no_match", tied: [] };
}

// ── Mention detection ──────────────────────────────────────────────────────

export type MentionWhere = "title" | "body";

export interface Mention {
  entity: ResolvedEntity;
  where: MentionWhere;
  /** The form that matched, so a relevance score can explain itself. */
  form: SurfaceForm;
}

const TIER_ALLOWED_OPEN: Record<FormTier, boolean> = {
  canonical: true,
  strong: true,
  weak: false,
};

/**
 * Does `title` / `body` name this entity, and where? Title beats body (a
 * headline naming a fighter is a stronger signal than a passing mention).
 *
 * The strongest form is checked first, so the returned `form` is the best
 * evidence available rather than whichever rule happened to fire.
 */
export function mentionOf(
  entity: ResolvedEntity,
  text: { title?: string; body?: string },
  opts: ResolveOpts = {},
): Mention | null {
  const forms = entity.forms.filter((f) => !opts.openSet || TIER_ALLOWED_OPEN[f.tier]);
  if (!forms.length) return null;

  const title = text.title ? haystack(text.title) : null;
  const body = text.body ? haystack(text.body) : null;

  for (const form of forms) {
    if (title && haystackHas(title, form.form)) return { entity, where: "title", form };
  }
  for (const form of forms) {
    if (body && haystackHas(body, form.form)) return { entity, where: "body", form };
  }
  return null;
}

/** Every entity in `entities` that the text names. Deterministic order. */
export function mentionsIn(
  entities: ResolvedEntity[],
  text: { title?: string; body?: string },
  opts: ResolveOpts = {},
): Mention[] {
  const out: Mention[] = [];
  for (const e of entities) {
    const m = mentionOf(e, text, opts);
    if (m) out.push(m);
  }
  return out;
}

/**
 * DB-searchable terms for a set of entities: the forms strong enough to put in a
 * `contains` query. Weak forms are excluded — a `LIKE '%aj%'` scan is exactly
 * the noise this layer exists to remove.
 */
export function searchTerms(entities: ResolvedEntity[], minLength = 3): string[] {
  const terms = new Set<string>();
  for (const e of entities) {
    for (const f of e.forms) {
      if (f.tier === "weak") continue;
      if (f.form.length < minLength) continue;
      terms.add(f.form);
    }
  }
  return [...terms];
}
