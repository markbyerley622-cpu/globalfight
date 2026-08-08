// ════════════════════════════════════════════════════════════════════════════
//  RICH ENTITIES — the structured layer under user-authored text.
//
//  ── The problem this replaces ─────────────────────────────────────────────
//  A mention was the string "@alex". Everything downstream re-derived meaning
//  from that string: the renderer regex-scanned for it, and the notifier
//  regex-scanned again and looked the name up. Three consequences, all silent:
//
//    • A username change ORPHANS every historical mention. "@alex123" keeps
//      pointing at a handle nobody owns, so the link 404s and the person is
//      never notified again about their own past.
//    • The renderer and the notifier can disagree. They already nearly did —
//      lib/mentions exists as one regex precisely because two would drift, and
//      the failure is a name styled as a mention that pinged nobody.
//    • Nothing else can ever be mentioned. An event, a gym, a fighter would
//      each need their own regex, their own resolver and their own renderer.
//
//  ── The model ─────────────────────────────────────────────────────────────
//  Text stays human-readable. Identity moves into a parallel ENTITY list that
//  references rows by ID:
//
//    { text: "I think @alex wins.",
//      entities: [{ type: "mention", id: "usr_123", start: 8, end: 13,
//                   hint: { username: "alex", name: "Alex Pereira" } }] }
//
//  `id` is the truth. `hint` is a rendering convenience that is ALLOWED to be
//  stale — it is refreshed from the database on read (see hydrate), so a
//  username change updates every historical mention of that person without
//  touching a single stored row.
//
//  ── Why one shape for every entity type ───────────────────────────────────
//  Events, gyms, fighters, promotions, prediction cards and WikiCards are all
//  the same shape: a span of text that stands for a row somewhere. Giving them
//  a shared envelope now means adding one is a `type` member and a resolver,
//  not a new parser, a new column and a new renderer.
//
//  PURE and client-safe: no prisma, no env, no React.
// ════════════════════════════════════════════════════════════════════════════

// Side-effect import: registers every built-in kind. Validation below asks the
// registry what exists, so without this a sanitize would drop every entity in
// the product. Kept here — the lowest module in the stack — so no consumer can
// forget it. There is no runtime cycle: the plugins import `registry`, and the
// only thing they take from this file is a type, which erases.
import "./plugins";
import { entityPlugin } from "./registry";

/**
 * What an entity stands for.
 *
 * ── Why this is `string` and not a union ──────────────────────────────────
 * It WAS a union of five literals, and every kind therefore cost an edit here
 * plus an edit to the validator below plus an edit to the renderer. The kinds
 * that actually exist are now declared by the plugin REGISTRY
 * (lib/rich-text/registry), and `sanitizeEntities` validates against what is
 * registered rather than against a literal restated in this file.
 *
 * TypeScript could not have checked this anyway: plugins register at runtime,
 * so a union here would only ever have been a second list to keep in step — and
 * the failure mode of it drifting is a stored kind the validator silently
 * drops. The registry is the one source of truth; see `entityKinds()`.
 */
export type EntityType = string;

/**
 * Display values cached at write time. ALWAYS treated as possibly stale.
 *
 * Refreshed from the database on read (see hydrate), which is what makes a
 * rename or a re-slug apply to every historical body without rewriting a row.
 */
export interface EntityHint {
  /** A person's handle as it was when written. Mentions route on this. */
  username?: string;
  /**
   * A row's URL slug — how fighters, events, gyms and promotions route.
   *
   * Separate from `username` because they are not the same fact: a handle is
   * chosen by a person and is unique across users, a slug is derived from a
   * name and is unique within its own table. One field serving both would make
   * `/u/<slug>` and `/gyms/<username>` typecheck.
   */
  slug?: string;
  /** Already through publicDisplayName — never a raw User.name. */
  name?: string;
}

export interface RichEntity {
  type: EntityType;
  /** The referenced row's primary key. THE identity. Never a username. */
  id: string;
  /** Index of the first character of the span, inclusive. */
  start: number;
  /** Index just past the span, exclusive. */
  end: number;
  hint?: EntityHint;
}

/** A body plus its structured layer. */
export interface RichContent {
  text: string;
  entities: RichEntity[];
}

/** Notifying "everyone I can name" is the cheapest spam vector in any forum. */
export const MAX_ENTITIES = 10;

// ── Validation ─────────────────────────────────────────────────────────────

const isString = (v: unknown): v is string => typeof v === "string";
const isIndex = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;

/**
 * Is this a kind anything knows how to handle?
 *
 * Asked of the REGISTRY, not of a literal in this file. An unregistered kind is
 * dropped for the same reason a malformed offset is: nothing downstream could
 * render, link or preview it, so keeping it would produce a span that is styled
 * as an entity and behaves as nothing — the exact "highlighted but inert"
 * failure the whole architecture exists to remove.
 */
const isKnownKind = (type: string): boolean => entityPlugin(type) !== null;

/**
 * Coerce untrusted JSON into entities, DROPPING anything that does not hold up.
 *
 * ── Why dropping rather than throwing ─────────────────────────────────────
 * Entities arrive from two places that can both be wrong: a client request, and
 * a JSON column written by an older version of this code. Throwing on a bad one
 * makes a single malformed entity take down the whole message — a post that
 * renders as a 500 instead of as text. Dropping degrades exactly one span back
 * to plain text, which is the same thing legacy content already does.
 *
 * Every rule below exists because violating it is exploitable or corrupting:
 *
 *   • Offsets must lie INSIDE the text. An entity claiming 0..9999 would make a
 *     renderer slice past the end and swallow the rest of the message.
 *   • Offsets must not OVERLAP. Two entities over the same characters cannot
 *     both render; the segmenter would emit the span twice.
 *   • start < end. A zero-width entity is an invisible link.
 *   • Sorted by start, so the segmenter can walk once without re-sorting.
 *
 * Note what is NOT checked here: that `id` refers to a real row. That is a
 * database question and belongs in the server-side resolver — this module is
 * pure so it can run on the client too.
 */
export function sanitizeEntities(raw: unknown, text: string): RichEntity[] {
  if (!Array.isArray(raw)) return [];

  const out: RichEntity[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (!isString(e.type) || !isKnownKind(e.type)) continue;
    if (!isString(e.id) || e.id.length === 0 || e.id.length > 64) continue;
    if (!isIndex(e.start) || !isIndex(e.end)) continue;
    if (e.start >= e.end) continue;
    if (e.end > text.length) continue;

    const hint = e.hint && typeof e.hint === "object"
      ? {
          username: isString((e.hint as EntityHint).username) ? (e.hint as EntityHint).username : undefined,
          slug: isString((e.hint as EntityHint).slug) ? (e.hint as EntityHint).slug : undefined,
          name: isString((e.hint as EntityHint).name) ? (e.hint as EntityHint).name : undefined,
        }
      : undefined;

    out.push({ type: e.type as EntityType, id: e.id, start: e.start, end: e.end, hint });
  }

  out.sort((a, b) => a.start - b.start);

  // Drop overlaps, keeping the earlier one. Deterministic, and it favours the
  // entity a reader's eye reaches first.
  const kept: RichEntity[] = [];
  let cursor = 0;
  for (const e of out) {
    if (e.start < cursor) continue;
    kept.push(e);
    cursor = e.end;
    if (kept.length >= MAX_ENTITIES) break;
  }
  return kept;
}

/** The user ids a body mentions — what the notifier reads instead of a regex. */
export function mentionedUserIds(entities: RichEntity[]): string[] {
  const seen = new Set<string>();
  for (const e of entities) if (e.type === "mention") seen.add(e.id);
  return [...seen];
}
