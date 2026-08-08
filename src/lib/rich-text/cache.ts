import { entityCacheKey } from "./registry";
import type { RichEntity } from "./types";

// ════════════════════════════════════════════════════════════════════════════
//  THE SHARED ENTITY CACHE — one fetch per entity, for the whole page.
//
//  ── The problem ───────────────────────────────────────────────────────────
//  A feed is full of the same few people. A thread where four members argue is
//  twenty chips over four ids. If each chip fetched its own preview, hovering
//  down that thread would issue twenty requests for four answers, and a reader
//  moving a mouse across three chips on the way to a fourth would fire three
//  requests they never wanted.
//
//  So no component fetches. Components ask THIS, and it guarantees:
//
//    dedupe        five chips for one id share ONE in-flight request
//    batch         requests raised in the same tick leave as one round trip
//    SWR           a cached answer renders instantly, then refreshes if stale
//    cancellation  the last subscriber leaving aborts a request nobody awaits
//    bounded       an LRU ceiling, so an infinite feed cannot grow it forever
//
//  ── Why a module singleton and not React context ──────────────────────────
//  The cache is not per-tree. A mention in the feed and the same person named
//  in a DM thread in a side panel are the same entity, and a context would give
//  them separate caches the moment the two live under different providers. It
//  is also read from event handlers (a hover prefetch fires before any render),
//  which a context value cannot serve.
//
//  Client-only: it holds AbortControllers and a timer. Server rendering never
//  touches it — previews are a hover interaction, and the first paint of a body
//  carries no preview data at all.
// ════════════════════════════════════════════════════════════════════════════

/** What the preview endpoint returns for one entity. Kind-specific shape. */
export interface EntityPreview {
  kind: string;
  id: string;
  /** Everything else is per-kind and validated by the view that renders it. */
  [field: string]: unknown;
}

export type EntityState =
  | { status: "idle" }
  | { status: "loading" }
  /** `stale` is true while a cached answer is being refreshed behind it. */
  | { status: "ready"; preview: EntityPreview; stale: boolean }
  /** The row is gone, or the viewer may not see it. Not retried on hover. */
  | { status: "missing" }
  | { status: "error" };

interface Entry {
  state: EntityState;
  /** When the answer landed. Drives staleness. */
  at: number;
  /** Live subscribers. Zero means the entry may be evicted or its fetch aborted. */
  listeners: Set<(s: EntityState) => void>;
  /** In-flight request for this key, if any. */
  inflight: AbortController | null;
}

/**
 * How long an answer is served without a refetch, and how long before it is
 * dropped entirely.
 *
 * FRESH is generous because none of this data changes on a human timescale
 * inside one session — a display name, a gym's member count, an event's date.
 * A hover that re-fetched every time would issue a request per hover for an
 * answer that was correct thirty seconds ago.
 */
const FRESH_MS = 60_000;

/**
 * The LRU ceiling.
 *
 * An infinite feed can name an unbounded number of people; without a ceiling
 * this map is a leak that grows for as long as the tab is open. 200 entries is
 * far more than any one screen shows and costs a few tens of kilobytes.
 */
const MAX_ENTRIES = 200;

const cache = new Map<string, Entry>();

/**
 * Evict the least recently used entries.
 *
 * Map preserves insertion order and `touch` re-inserts on read, so the oldest
 * keys are simply the first ones. Entries with live listeners are SKIPPED —
 * evicting something currently on screen would blank an open hover card and
 * immediately refetch it.
 */
function evict(): void {
  if (cache.size <= MAX_ENTRIES) return;
  for (const [key, entry] of cache) {
    if (cache.size <= MAX_ENTRIES) break;
    if (entry.listeners.size > 0) continue;
    entry.inflight?.abort();
    cache.delete(key);
  }
}

/** Mark a key as most-recently-used. */
function touch(key: string, entry: Entry): void {
  cache.delete(key);
  cache.set(key, entry);
}

function entryFor(key: string): Entry {
  const existing = cache.get(key);
  if (existing) {
    touch(key, existing);
    return existing;
  }
  const fresh: Entry = { state: { status: "idle" }, at: 0, listeners: new Set(), inflight: null };
  cache.set(key, fresh);
  evict();
  return fresh;
}

function publish(entry: Entry, state: EntityState): void {
  entry.state = state;
  for (const listener of entry.listeners) listener(state);
}

// ── Batching ────────────────────────────────────────────────────────────────
//  Requests raised in the same tick leave together. Opening a thread prefetches
//  every visible chip; without this that is one request per chip, all in the
//  same millisecond, which is worse than the problem it solves.

const pending = new Map<string, { type: string; id: string }>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Server ceiling for one batch. Matches the route's own cap. */
const MAX_BATCH = 24;

function schedule(): void {
  if (flushTimer !== null) return;
  // A microtask would batch only synchronous callers. A 0ms timer also catches
  // the chips that mount in the same frame but in different effects, which is
  // what a list actually does.
  flushTimer = setTimeout(flush, 0);
}

async function flush(): Promise<void> {
  flushTimer = null;
  if (pending.size === 0) return;

  const batch = [...pending.values()].slice(0, MAX_BATCH);
  for (const item of batch) pending.delete(entityCacheKey({ type: item.type, id: item.id }));
  // Anything over the cap goes in the next tick rather than being dropped.
  if (pending.size > 0) schedule();

  const controller = new AbortController();
  const keys = batch.map((b) => entityCacheKey({ type: b.type, id: b.id }));
  for (const key of keys) {
    const entry = cache.get(key);
    if (entry) entry.inflight = controller;
  }

  try {
    const res = await fetch("/api/entities/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entities: batch }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { previews?: EntityPreview[] };

    const byKey = new Map(
      (data.previews ?? []).map((p) => [entityCacheKey({ type: p.kind, id: p.id }), p]),
    );

    for (const key of keys) {
      const entry = cache.get(key);
      if (!entry) continue;
      entry.inflight = null;
      entry.at = Date.now();
      const preview = byKey.get(key);
      // Asked for and not returned means the row is gone, or this viewer may
      // not see it. Cached as `missing` rather than left idle, so hovering it
      // again does not fire the same refused request forever.
      publish(entry, preview ? { status: "ready", preview, stale: false } : { status: "missing" });
    }
  } catch (err) {
    // An abort is not a failure — it is the last subscriber having left. Leave
    // the entry alone so the next hover starts cleanly rather than showing an
    // error for a request nobody was waiting on.
    const aborted = err instanceof DOMException && err.name === "AbortError";
    for (const key of keys) {
      const entry = cache.get(key);
      if (!entry) continue;
      entry.inflight = null;
      if (aborted) {
        if (entry.state.status === "loading") publish(entry, { status: "idle" });
      } else {
        entry.at = Date.now();
        publish(entry, { status: "error" });
      }
    }
  }
}

/** Queue a key for the next batch, unless an answer is already good enough. */
function request(entity: Pick<RichEntity, "type" | "id">, force: boolean): void {
  const key = entityCacheKey(entity);
  const entry = entryFor(key);

  if (entry.inflight) return;
  if (entry.state.status === "missing") return;

  const fresh = Date.now() - entry.at < FRESH_MS;
  if (!force && fresh && entry.state.status === "ready") return;

  // STALE-WHILE-REVALIDATE: a cached answer keeps rendering, flagged stale, so
  // a refresh never blanks a card the reader is already looking at.
  if (entry.state.status === "ready") publish(entry, { ...entry.state, stale: true });
  else publish(entry, { status: "loading" });

  pending.set(key, { type: entity.type, id: entity.id });
  schedule();
}

// ── The public surface ──────────────────────────────────────────────────────

/**
 * Warm an entity without subscribing.
 *
 * Called on pointer-enter, BEFORE the hover delay elapses — so by the time the
 * card is due to open the answer is usually already here and it opens with
 * content rather than with a spinner. Costs nothing when the entry is fresh.
 */
export function prefetchEntity(entity: Pick<RichEntity, "type" | "id">): void {
  request(entity, false);
}

/** The cached state for a key right now, without subscribing or fetching. */
export function peekEntity(entity: Pick<RichEntity, "type" | "id">): EntityState {
  return cache.get(entityCacheKey(entity))?.state ?? { status: "idle" };
}

/**
 * Subscribe to an entity, fetching it if needed.
 *
 * Returns an unsubscribe. When the LAST subscriber leaves and a request is
 * still in flight, that request is ABORTED — a card closed before its preview
 * lands is a card nobody is waiting for, and on a slow connection the
 * alternative is a queue of responses for chips the reader has long passed.
 */
export function subscribeEntity(
  entity: Pick<RichEntity, "type" | "id">,
  onChange: (s: EntityState) => void,
): () => void {
  const key = entityCacheKey(entity);
  const entry = entryFor(key);
  entry.listeners.add(onChange);

  onChange(entry.state);
  request(entity, false);

  return () => {
    entry.listeners.delete(onChange);
    if (entry.listeners.size === 0 && entry.inflight) {
      entry.inflight.abort();
      entry.inflight = null;
      // Back to idle, not error: nothing failed, the reader simply moved on.
      if (entry.state.status === "loading") entry.state = { status: "idle" };
    }
  };
}

/**
 * Write a preview straight into the cache.
 *
 * The optimistic path: a surface that ALREADY holds the facts — a profile page
 * rendering its own subject, a feed row that carries its author — seeds them so
 * hovering that person never fetches at all.
 */
export function seedEntity(preview: EntityPreview): void {
  const key = entityCacheKey({ type: preview.kind, id: preview.id });
  const entry = entryFor(key);
  entry.at = Date.now();
  publish(entry, { status: "ready", preview, stale: false });
}

/** Testing seam. Drops everything, aborting anything in flight. */
export function resetEntityCache(): void {
  for (const entry of cache.values()) entry.inflight?.abort();
  cache.clear();
  pending.clear();
  if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
}

/** Testing/diagnostics seam: how many entries are held right now. */
export function entityCacheSize(): number {
  return cache.size;
}
