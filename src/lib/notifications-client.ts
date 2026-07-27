"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NotificationGroup } from "@/lib/notifications-group";

// ════════════════════════════════════════════════════════════════════════════
//  ONE client for the notification list. The bell and the notification centre
//  are the same data with two layouts, and they used to be two fetch loops with
//  two copies of the unread count — which is how a badge ends up disagreeing with
//  the list directly beneath it.
//
//  ── WHY THE TRANSPORT IS ISOLATED ─────────────────────────────────────────
//  Delivery is a 60-second poll today and that behaviour is UNCHANGED here. But
//  this app already has an SSE stream (api/forums/stream, Postgres LISTEN/NOTIFY
//  upstream) and notifications are the obvious next subscriber, so the poll lives
//  behind `subscribe()` below: one function, whose whole contract is "call `tick`
//  when something may have changed, return a teardown".
//
//  Swapping to SSE is then replacing that function body with the EventSource shape
//  useForumStream already uses — poll as the fallback that engages on error, never
//  the primary. No component changes, no state-shape change, no second copy of the
//  unread count. That is the whole point of the seam.
// ════════════════════════════════════════════════════════════════════════════

const POLL_MS = 60_000;

/**
 * Tell the hook something may have changed. Returns a teardown.
 *
 * The SSE swap replaces this body and nothing else.
 */
function subscribe(tick: () => void): () => void {
  const id = setInterval(tick, POLL_MS);
  return () => clearInterval(id);
}

interface Payload {
  groups: NotificationGroup[];
  unread: number;
  nextCursor: string | null;
}

async function fetchPage(cursor?: string | null): Promise<Payload> {
  const qs = new URLSearchParams({ limit: "20", ...(cursor ? { cursor } : {}) });
  const res = await fetch(`/api/me/notifications?${qs}`);
  if (!res.ok) throw new Error("notifications unavailable");
  return (await res.json()) as Payload;
}

export interface NotificationsState {
  /** Null while the FIRST page is loading — the signal to render skeletons. */
  groups: NotificationGroup[] | null;
  unread: number;
  /** More history exists below. */
  hasMore: boolean;
  /** A page (not the first) is in flight. */
  loadingMore: boolean;
  /** The last fetch failed and nothing is on screen. */
  error: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  markRead: (group: NotificationGroup) => void;
  markAllRead: () => void;
  remove: (group: NotificationGroup) => void;
}

export function useNotifications(options: { enabled?: boolean } = {}): NotificationsState {
  const enabled = options.enabled !== false;
  const [groups, setGroups] = useState<NotificationGroup[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  // A page fetched after the component unmounted (or after a newer refresh
  // started) must not land: it would resurrect rows the user just deleted.
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const d = await fetchPage();
      if (generation.current !== mine) return;
      setGroups(d.groups);
      setUnread(d.unread);
      setCursor(d.nextCursor);
      setError(false);
    } catch {
      if (generation.current !== mine) return;
      // Keep whatever is already on screen — a transient failure must not blank
      // the list the reader is looking at.
      setGroups((g) => g ?? []);
      setError(true);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const mine = generation.current;
    try {
      const d = await fetchPage(cursor);
      // A refresh that started after this page did wins: its data is newer, and
      // appending to a list that has been replaced would duplicate rows.
      if (generation.current !== mine) return;
      setGroups((g) => [...(g ?? []), ...d.groups]);
      setUnread(d.unread);
      setCursor(d.nextCursor);
    } catch {
      /* the "load more" affordance stays — the reader can try again */
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore]);

  useEffect(() => {
    if (!enabled) return;
    // set-state-in-effect is disabled because its premise does not hold here:
    // refresh() awaits a fetch before it touches state, so nothing is set
    // synchronously and there is no cascading render. Fetching the first page on
    // mount and then subscribing is exactly the "subscribe to an external system"
    // shape the rule exists to protect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    return subscribe(() => void refresh());
  }, [enabled, refresh]);

  /**
   * OPTIMISTIC read. The row flips instantly and the server is told afterwards —
   * a read receipt is not worth a spinner, and a group is one request for all of
   * its member ids rather than one per row.
   *
   * No router.refresh(): the unread count lives in this hook, not in a server
   * component, so re-rendering the tree would buy nothing and cost a round-trip.
   */
  const markRead = useCallback((group: NotificationGroup) => {
    const ids = group.members.filter((m) => !m.readAt).map((m) => m.id);
    if (!ids.length) return;
    const now = new Date().toISOString();
    setGroups((g) =>
      (g ?? []).map((x) =>
        x.id === group.id
          ? { ...x, unread: false, members: x.members.map((m) => (m.readAt ? m : { ...m, readAt: now })) }
          : x,
      ),
    );
    setUnread((u) => Math.max(0, u - ids.length));
    void fetch("/api/me/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    })
      // Reconcile against the server's own count rather than trusting the local
      // decrement, which drifts if two tabs read the same rows.
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d.unread === "number") setUnread(d.unread); })
      .catch(() => {});
  }, []);

  const markAllRead = useCallback(() => {
    setGroups((g) => (g ?? []).map((x) => ({
      ...x, unread: false, members: x.members.map((m) => (m.readAt ? m : { ...m, readAt: new Date().toISOString() })),
    })));
    setUnread(0);
    void fetch("/api/me/notifications", { method: "POST" }).catch(() => {});
  }, []);

  /** Optimistic delete, restored from the server on failure. */
  const remove = useCallback((group: NotificationGroup) => {
    const ids = group.members.map((m) => m.id);
    setGroups((g) => (g ?? []).filter((x) => x.id !== group.id));
    if (group.unread) setUnread((u) => Math.max(0, u - group.members.filter((m) => !m.readAt).length));
    void fetch("/api/me/notifications", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    })
      .then((r) => { if (!r.ok) void refresh(); })
      .catch(() => void refresh());
  }, [refresh]);

  return {
    groups,
    unread,
    hasMore: cursor !== null,
    loadingMore,
    error,
    refresh,
    loadMore,
    markRead,
    markAllRead,
    remove,
  };
}
