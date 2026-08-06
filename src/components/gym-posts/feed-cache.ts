"use client";

import type { GymPostDTO } from "@/lib/gym-posts/types";

// ════════════════════════════════════════════════════════════════════════════
//  Keeping an infinite feed alive across a Back navigation.
//
//  ── Why this is needed even though scroll restoration already exists ─────
//  ScrollRestoration (components/layout/scroll-restoration) solves the app-wide
//  half of this properly: it records `#main`'s scrollTop and re-applies it in a
//  convergence loop that keeps trying WHILE THE CONTAINER IS STILL GROWING.
//
//  That loop cannot help an infinite feed on its own. Open a post from page
//  four, press Back, and the feed remounts holding page ONE — so the container
//  never grows past a few hundred pixels, and the loop faithfully restores a
//  position that no longer exists. The reader lands at the top of a feed they
//  had scrolled a long way down.
//
//  The missing half is the DATA. Restore the pages and the height comes back on
//  its own, and the existing loop then does exactly what it was written to do.
//
//  ── sessionStorage, and its limits, on purpose ───────────────────────────
//  Per-tab and cleared when the tab closes, which is the right lifetime for
//  "where I was just now" — a feed restored from yesterday would be stale
//  content presented as current. Entries carry a timestamp and expire, and the
//  cache is capped, because a long browsing session must not grow storage
//  without bound. A quota error degrades to no caching at all rather than
//  breaking the feed; this is a convenience, never a source of truth.
// ════════════════════════════════════════════════════════════════════════════

const KEY = "gf:gymFeed";
/** Older than this and the feed is refetched — stale posts are worse than a scroll. */
const TTL_MS = 10 * 60_000;
/** Hard ceiling on cached posts per feed, so one long scroll cannot fill storage. */
const MAX_ITEMS = 120;

interface Entry {
  at: number;
  items: GymPostDTO[];
  cursor: string | null;
}

type Store = Record<string, Entry>;

function read(): Store {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Store;
  } catch {
    return {};
  }
}

/** Identity of a feed: which gym (or the cross-gym one). */
export const feedKey = (gymSlug: string | null) => gymSlug ?? "__all__";

export function loadFeed(key: string): Entry | null {
  try {
    const entry = read()[key];
    if (!entry || Date.now() - entry.at > TTL_MS) return null;
    return entry;
  } catch {
    return null;
  }
}

export function saveFeed(key: string, items: GymPostDTO[], cursor: string | null): void {
  try {
    const store = read();
    store[key] = { at: Date.now(), items: items.slice(0, MAX_ITEMS), cursor };
    // Drop everything stale on every write. Cheap, and it means the cache
    // cannot accumulate feeds the reader has finished with.
    for (const [k, v] of Object.entries(store)) {
      if (Date.now() - v.at > TTL_MS) delete store[k];
    }
    sessionStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Quota or private mode. Restoration degrades; the feed still works.
  }
}

/** Forget a feed — after publishing, where the cached copy is now behind. */
export function dropFeed(key: string): void {
  try {
    const store = read();
    delete store[key];
    sessionStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // See above.
  }
}
