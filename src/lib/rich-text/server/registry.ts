import "server-only";
import type { EntityHint } from "../types";
import type { EntityPreview } from "../cache";

// ════════════════════════════════════════════════════════════════════════════
//  THE ENTITY SOURCE — everything a kind needs from the database, in one place.
//
//  ── Why these four operations live together ───────────────────────────────
//  A kind is asked four questions by the server, and every one of them is the
//  same question about the same table:
//
//    suggest   "what could the author have meant by this text?"   (picker)
//    resolve   "which row is this, and freeze its identity"       (write)
//    hydrate   "what is that row called TODAY?"                   (read)
//    preview   "tell me enough to draw a hover card"              (hover)
//
//  They were heading for three separate registries — the preview loaders shipped
//  first, and suggest and resolve would each have wanted their own. That is
//  three files per kind, three manifests, and three places to forget. Worse,
//  they cannot actually be independent: `suggest` hands out the KEY that
//  `resolve` must accept, and `resolve` writes the hint that `hydrate` refreshes.
//  Splitting them would have put both ends of two contracts in different files.
//
//  So one object per kind answers all four, and adding a kind is one server
//  file. `suggest` is optional — a kind can be storable, renderable and
//  previewable without being something a composer offers (gyms and promotions
//  are exactly that today).
//
//  ── The invariant that matters most ───────────────────────────────────────
//  A KEY is public — a username, a slug. It is what a URL already exposes and
//  what a client is allowed to send. An ID is a primary key and is NEVER
//  accepted from a client: `resolve` takes keys and looks the id up itself.
//  That is the whole reason this interface takes `keys` and not `ids`.
// ════════════════════════════════════════════════════════════════════════════

/** Who is asking. Sources use it for viewer-scoped fields and visibility. */
export interface SourceContext {
  viewerId: string | null;
}

/**
 * One row a picker can offer.
 *
 * Deliberately GENERIC. The Composer renders these fields and nothing else, so
 * it never learns what a fighter is — see the Composer's own note, and
 * __tests__/composer-extensibility.
 */
export interface EntitySuggestion {
  kind: string;
  /**
   * The PUBLIC handle for this row — a username, a slug. Sent back at submit,
   * and the only identifier the browser ever holds.
   */
  key: string;
  /**
   * The text that will be inserted into the body, WITHOUT the "@".
   *
   * Usually the title, but not always: a person inserts as their handle
   * (`@alex`) while a fighter inserts as their name (`@Alex Pereira`), because
   * that is what reads naturally in a sentence.
   */
  insert: string;
  /** Primary line in the menu. */
  title: string;
  /** Secondary line. Omit rather than inventing filler. */
  subtitle?: string | null;
  /** Avatar, poster or logo. Null falls back to an initial in the kind's tone. */
  imageUrl?: string | null;
  /** A verification tick, where the kind has such a concept. */
  verified?: boolean;
}

/** What `resolve` found: the id to store, and the hint to stamp beside it. */
export interface ResolvedRow {
  id: string;
  hint: EntityHint;
  /**
   * The text the span MUST read for this row to be accepted.
   *
   * Returned by the source rather than assumed by the resolver, because it
   * differs by kind: a mention's span is `@handle`, a fighter's is `@Name`.
   * Compared case-insensitively — see resolveDraftEntities.
   */
  expect: string;
}

export interface EntitySource {
  kind: string;

  /**
   * Rows matching `q` for the composer's picker.
   *
   * Optional: a kind with no suggester is simply never offered. It remains
   * fully storable, renderable and previewable.
   *
   * Contract: BOUNDED (the caller passes a limit and it is a ceiling, not a
   * hint), visibility-filtered for the viewer, and ranked best-first — the
   * caller merges kinds by rank and does not re-sort within one.
   */
  suggest?(q: string, limit: number, ctx: SourceContext): Promise<EntitySuggestion[]>;

  /**
   * Turn PUBLIC keys into stored identity.
   *
   * One query for the whole batch. A key that does not resolve — nonsense,
   * deleted, or not visible to this viewer — is simply absent from the map, and
   * the caller degrades that span to plain text.
   */
  resolve(keys: string[], ctx: SourceContext): Promise<Map<string, ResolvedRow>>;

  /**
   * Refresh display hints for stored ids.
   *
   * This is what makes a rename or a re-slug reach every historical body
   * without rewriting a row. An id that no longer resolves is absent, and the
   * caller renders the span as unlinked text.
   */
  hydrate(ids: string[], ctx: SourceContext): Promise<Map<string, EntityHint>>;

  /** Hover-card data. See the loaders' contract in server/index. */
  preview(ids: string[], ctx: SourceContext): Promise<EntityPreview[]>;
}

const SOURCES = new Map<string, EntitySource>();

export function registerEntitySource(source: EntitySource): void {
  const existing = SOURCES.get(source.kind);
  if (existing && existing !== source) {
    throw new Error(`Two entity sources registered for kind "${source.kind}".`);
  }
  SOURCES.set(source.kind, source);
}

export function entitySource(kind: string): EntitySource | null {
  return SOURCES.get(kind) ?? null;
}

export function entitySources(): EntitySource[] {
  return [...SOURCES.values()];
}

/** The kinds a composer may offer — those whose source implements `suggest`. */
export function suggestableKinds(): string[] {
  return entitySources().filter((s) => s.suggest).map((s) => s.kind);
}
