import "server-only";
import type { EntityPreview } from "../cache";
import { MAX_ENTITIES, sanitizeEntities, type RichEntity } from "../types";
import { entitySource, entitySources, type EntitySuggestion, type SourceContext } from "./registry";

// ── The source manifest ─────────────────────────────────────────────────────
//  Importing a file is what registers it. A source left out here never runs,
//  and its kind silently loses resolution, hydration and previews — so
//  registry-extensibility fails if a file in this directory is missing.
import "./mention";
import "./fighter";
import "./event";
import "./gym";
import "./promotion";

export {
  registerEntitySource, entitySource, suggestableKinds,
  type EntitySuggestion, type SourceContext,
} from "./registry";

// ════════════════════════════════════════════════════════════════════════════
//  THE FAN-OUT — four operations, none of which knows a kind's name.
//
//  Every function here groups by kind, calls that kind's source once with all
//  of its keys or ids, and merges. So a body naming four people, an event and a
//  gym costs three queries rather than six, and adding a seventh kind changes
//  nothing in this file.
//
//  Kinds run CONCURRENTLY: they are independent reads against different tables,
//  and sequencing them would make the slowest one the floor for every caller.
//
//  ── Failure is per-KIND, never per-batch ──────────────────────────────────
//  A source that throws yields nothing for its kind and the rest of the batch
//  still answers. The alternative — one bad row taking down a page of content —
//  is the failure mode these are most likely to hit, because they read tables
//  that ingest writes to.
// ════════════════════════════════════════════════════════════════════════════

/** Group (kind, value) pairs into one deduped set of values per kind. */
function groupByKind(items: { type: string; value: string }[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const item of items) {
    // An unregistered kind is skipped in silence. It is what an older server
    // sees from a newer client, and refusing the batch over one unknown kind
    // would lose the answers it could have given.
    if (!entitySource(item.type)) continue;
    const set = out.get(item.type) ?? new Set<string>();
    set.add(item.value);
    out.set(item.type, set);
  }
  return out;
}

/** Run one source operation per kind, concurrently, swallowing per-kind faults. */
async function perKind<R>(
  grouped: Map<string, Set<string>>,
  run: (kind: string, values: string[]) => Promise<R>,
  empty: R,
): Promise<Map<string, R>> {
  const entries = await Promise.all(
    [...grouped].map(async ([kind, values]): Promise<[string, R]> => {
      try {
        return [kind, await run(kind, [...values])];
      } catch {
        return [kind, empty];
      }
    }),
  );
  return new Map(entries);
}

// ── SUGGEST (the composer's picker) ─────────────────────────────────────────

/**
 * Ask every suggestable kind at once and return ONE ranked list.
 *
 * ── Why a flat list and not a map of kinds ────────────────────────────────
 * The client groups by kind for display, but the ORDER of those groups is a
 * ranking question, and the server is where ranking belongs. Returning a map
 * would have made the client pick an order — and the only orders it could pick
 * are a hard-coded one (which is the switch this architecture exists to avoid)
 * or registration order (which is arbitrary).
 *
 * So: kinds are interleaved by their own rank position, and the client renders
 * groups in order of first appearance. A query that matches a person best puts
 * People first; one that matches an event best puts Events first. Nobody had to
 * encode "people before fighters" anywhere.
 */
export async function suggestEntities(
  q: string,
  ctx: SourceContext,
  perKindLimit: number,
  total: number,
): Promise<EntitySuggestion[]> {
  const sources = entitySources().filter((s) => s.suggest);

  const lists = await Promise.all(
    sources.map(async (s) => {
      try {
        return (await s.suggest!(q, perKindLimit, ctx)).slice(0, perKindLimit);
      } catch {
        // One kind failing must not empty the picker.
        return [] as EntitySuggestion[];
      }
    }),
  );

  // Round-robin by rank: each kind's best, then each kind's second, and so on.
  // Every kind that matched at all is therefore visible without any kind being
  // able to crowd the others out — a fighter search that returns eight results
  // must not hide the one person the author actually meant.
  const merged: EntitySuggestion[] = [];
  const depth = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < depth && merged.length < total; i++) {
    for (const list of lists) {
      if (merged.length >= total) break;
      if (list[i]) merged.push(list[i]);
    }
  }
  return merged;
}

// ── RESOLVE (the write path) ────────────────────────────────────────────────

/**
 * What the client sends: a span, a kind, and a PUBLIC key.
 *
 * `username` is the legacy field name and is still accepted — every composer
 * that shipped before this sent `{ type: "mention", username }`, and content is
 * still being written by tabs holding that bundle.
 */
export interface DraftEntity {
  type: string;
  key?: string;
  /** Legacy alias for `key`, mentions only. */
  username?: string;
  start: number;
  end: number;
}

const isIndex = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;

/** Keys are handles and slugs. Anything outside this is not one. */
const KEY_RE = /^[a-zA-Z0-9_-]{1,80}$/;

/**
 * Turn draft spans into verified, stored entities.
 *
 * ── The three checks, and why each exists ─────────────────────────────────
 * 1. SHAPE, before any query. A malformed draft is dropped, never thrown on —
 *    autocomplete data goes stale constantly and a 500 for it would be absurd.
 * 2. EXISTENCE AND VISIBILITY, by the kind's own source. The client sends a
 *    key; the server looks up the id. A client-supplied id is never accepted
 *    anywhere in this pipeline, which is why `resolve` takes keys.
 * 3. THE SPAN MUST BE THE THING. The stored text is re-sliced and required to
 *    equal what the row is actually called (`expect`, returned by the source).
 *    Without this a client could attach any entity's id to any span — including
 *    a span over somebody else's words — and it would render, link and notify.
 *    A stale selection (the row was renamed after the menu was drawn) fails
 *    here and degrades to plain text, which is correct: the words no longer say
 *    what the entity says.
 *
 * ONE query per KIND, however many entities the body carries.
 */
export async function resolveDraftEntities(
  text: string,
  raw: unknown,
  ctx: SourceContext = { viewerId: null },
): Promise<RichEntity[]> {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const drafts: Required<Pick<DraftEntity, "type" | "key" | "start" | "end">>[] = [];
  for (const item of raw.slice(0, MAX_ENTITIES * 2)) {
    if (!item || typeof item !== "object") continue;
    const d = item as DraftEntity;
    if (typeof d.type !== "string" || !entitySource(d.type)) continue;
    const key = typeof d.key === "string" ? d.key : d.username;
    if (typeof key !== "string" || !KEY_RE.test(key)) continue;
    if (!isIndex(d.start) || !isIndex(d.end) || d.start >= d.end || d.end > text.length) continue;
    drafts.push({ type: d.type, key, start: d.start, end: d.end });
  }
  if (drafts.length === 0) return [];

  const resolved = await perKind(
    groupByKind(drafts.map((d) => ({ type: d.type, value: d.key }))),
    (kind, keys) => entitySource(kind)!.resolve(keys, ctx),
    new Map(),
  );

  const entities: RichEntity[] = drafts.flatMap((d) => {
    const row = resolved.get(d.type)?.get(d.key)
      // Handles are matched case-insensitively by the source but keyed by their
      // canonical casing, so a draft typed as "@ALEX" still finds "alex".
      ?? resolved.get(d.type)?.get(d.key.toLowerCase());
    if (!row) return [];
    // Check 3. Case-insensitive: a handle typed in another case is the same
    // person, and a name is not case-sensitive either.
    if (text.slice(d.start, d.end).toLowerCase() !== row.expect.toLowerCase()) return [];
    return [{ type: d.type, id: row.id, start: d.start, end: d.end, hint: row.hint }];
  });

  // The same sanitiser the read path uses, so anything stored is already
  // known-good by the rules the renderer will apply to it.
  return sanitizeEntities(entities, text);
}

// ── HYDRATE (the read path) ─────────────────────────────────────────────────

/**
 * Refresh stored entities against the CURRENT state of the rows they name.
 *
 * ── Why on read rather than as a migration ───────────────────────────────
 * A rename would otherwise have to rewrite every historical row that mentioned
 * that person — unbounded write amplification on a routine profile edit, and
 * one that silently misses anything written later. A batched lookup on read
 * costs one query per KIND per page and is always correct.
 *
 * A row that is gone keeps its SPAN but loses its hint, so the renderer shows
 * the original words without a link rather than deleting them from a sentence
 * that was written around them.
 */
export async function hydrateEntities(
  rows: { text: string; entities: unknown }[],
  ctx: SourceContext = { viewerId: null },
): Promise<RichEntity[][]> {
  const per = rows.map((r) => sanitizeEntities(r.entities, r.text));
  const all = per.flat();
  if (all.length === 0) return per;

  const hints = await perKind(
    groupByKind(all.map((e) => ({ type: e.type, value: e.id }))),
    (kind, ids) => entitySource(kind)!.hydrate(ids, ctx),
    new Map(),
  );

  return per.map((entities) =>
    entities.map((e) => {
      const hint = hints.get(e.type)?.get(e.id);
      return hint
        ? { ...e, hint }
        // Gone. Keep the span and the NAME (so the words still read), drop the
        // routing key — the renderer reads an absent slug/handle as "render the
        // text, do not link it".
        : { ...e, hint: { name: e.hint?.name } };
    }),
  );
}

/** Convenience for a single body. */
export async function hydrateOne(
  text: string,
  entities: unknown,
  ctx?: SourceContext,
): Promise<RichEntity[]> {
  const [out] = await hydrateEntities([{ text, entities }], ctx);
  return out;
}

// ── PREVIEW (the hover path) ────────────────────────────────────────────────

export interface PreviewRequest {
  type: string;
  id: string;
}

export async function loadPreviews(
  requested: PreviewRequest[],
  ctx: SourceContext,
): Promise<EntityPreview[]> {
  const results = await perKind(
    groupByKind(requested.map((r) => ({ type: r.type, value: r.id }))),
    (kind, ids) => entitySource(kind)!.preview(ids, ctx),
    [] as EntityPreview[],
  );
  return [...results.values()].flat();
}
