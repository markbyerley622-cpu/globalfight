"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BellOff, Check, Loader2, Trash2, UserPlus, UserCheck } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { NotificationIcon } from "@/components/notifications/notification-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics-client";
import type { NotificationGroup } from "@/lib/notifications-group";
import type { NotificationsState } from "@/lib/notifications-client";

// ════════════════════════════════════════════════════════════════════════════
//  The notification list, used by BOTH the bell sheet and the full centre.
//
//  Same rows, same grouping, same read/delete behaviour — the only difference is
//  the frame around it. Two implementations would mean the sheet and the page
//  disagreeing about what "read" looks like, which is the sort of thing a reader
//  notices immediately and cannot articulate.
// ════════════════════════════════════════════════════════════════════════════

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - +new Date(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function NotificationSkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    // aria-hidden + a live-region announcement instead: a screen reader must hear
    // "loading", not five rows of decorative grey blocks.
    <div aria-hidden className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 rounded-xl border border-ink-800 bg-ink-900 px-3 py-2.5">
          <Skeleton className="size-6 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * One-tap follow-back, inside the "X followed you" row.
 *
 * Only rendered for a single-member FOLLOW group: once several follows have
 * collapsed into "3 people followed you" there is no single person to reciprocate
 * with, and the row links to the list instead.
 *
 * Optimistic, and it reverts on failure — the button is a statement about a
 * relationship, so leaving it showing "Following" after a failed write would be a
 * lie the user acts on later.
 */
function FollowBackButton({ username, initiallyFollowing }: { username: string; initiallyFollowing: boolean }) {
  const [following, setFollowing] = useState(initiallyFollowing);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !following;
    setFollowing(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(username)}/follow`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ follow: next }),
      });
      if (!res.ok) throw new Error("failed");
      const data = (await res.json()) as { following?: boolean };
      // Trust the server's answer over ours.
      if (typeof data.following === "boolean") setFollowing(data.following);
    } catch {
      setFollowing(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      // The row is wrapped in a Link; without this the tap navigates to the
      // profile instead of following, which is the single most likely way for this
      // control to feel broken.
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); void toggle(); }}
      disabled={busy}
      aria-label={following ? `Unfollow ${username}` : `Follow ${username} back`}
      className={cn(
        "tap relative z-10 mt-2 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[0.7rem] font-bold uppercase tracking-wide transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400",
        following
          ? "border-ink-700 bg-ink-850 text-mist hover:text-chalk"
          : "border-blood-500/50 bg-blood-500/15 text-blood-200 hover:border-blood-500 hover:bg-blood-500/25",
      )}
    >
      {following ? <UserCheck className="size-3.5" /> : <UserPlus className="size-3.5" />}
      {following ? "Following" : "Follow back"}
    </button>
  );
}

function GroupRow({
  group,
  onRead,
  onRemove,
  onNavigate,
}: {
  group: NotificationGroup;
  onRead: (g: NotificationGroup) => void;
  onRemove: (g: NotificationGroup) => void;
  onNavigate?: () => void;
}) {
  // A single new follower is the one notification with an obvious reciprocal
  // action; offer it in place rather than making them open the profile for it.
  const actor = group.count === 1 ? group.members[0]?.actor : null;

  const body = (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors",
        group.unread
          ? "border-blood-500/30 bg-blood-500/5 hover:border-blood-500/50"
          : "border-ink-800 bg-ink-900 hover:border-ink-700",
      )}
    >
      <NotificationIcon notification={group} />
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm", group.unread ? "font-semibold text-chalk" : "text-mist")}>
          {group.title}
        </p>
        {group.body && <p className="mt-0.5 text-xs text-mist">{group.body}</p>}
        {actor && <FollowBackButton username={actor.username} initiallyFollowing={actor.youFollow} />}
        <p className="mt-1 flex items-center gap-1.5 text-[0.68rem] uppercase tracking-wide text-fog">
          <time dateTime={group.createdAt}>{timeAgo(group.createdAt)}</time>
          {group.count > 1 && (
            <>
              <span aria-hidden>·</span>
              <span>{group.count} notifications</span>
            </>
          )}
        </p>
      </div>
      {/* The unread dot is decorative — the state is already in the accessible
          name of the row's actions and in the live region above the list. */}
      {group.unread && <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-blood-500" />}
    </div>
  );

  return (
    <li className="group/row relative">
      {group.url ? (
        <Link
          href={group.url}
          // Reading it IS opening it. Firing this before navigation rather than
          // after means the optimistic flip is already painted when the page
          // changes, instead of racing the route transition.
          onClick={() => {
            onRead(group);
            track("notification_click", { type: group.type, grouped: group.count > 1 });
            onNavigate?.();
          }}
          aria-label={`${group.unread ? "Unread: " : ""}${group.title}${group.count > 1 ? ` — ${group.count} notifications` : ""}`}
          className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
        >
          {body}
        </Link>
      ) : (
        body
      )}

      {/* Row actions. Always in the DOM and always reachable by keyboard —
          revealing them on hover only would make them unusable on touch and
          invisible to a keyboard user. Opacity is the only thing hover changes. */}
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100 max-md:opacity-100">
        {group.unread && (
          <button
            type="button"
            onClick={() => onRead(group)}
            aria-label={`Mark "${group.title}" as read`}
            className="tap grid size-8 place-items-center rounded-lg border border-ink-700 bg-ink-850 text-mist transition-colors hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
          >
            <Check className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => onRemove(group)}
          aria-label={`Delete "${group.title}"`}
          className="tap grid size-8 place-items-center rounded-lg border border-ink-700 bg-ink-850 text-mist transition-colors hover:border-blood-500/40 hover:text-blood-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </li>
  );
}

/**
 * Infinite scroll via IntersectionObserver, with a real button behind it.
 *
 * The sentinel is a progressive enhancement, never the only way down: a keyboard
 * user tabs to the button, and a reader whose observer never fires (or who has
 * scripting throttled in a background tab) still has something to press.
 */
function LoadMore({ state }: { state: NotificationsState }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const loadMore = state.loadMore;

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) void loadMore(); },
      // Start fetching before the sentinel is actually visible, so the next page
      // is usually already there by the time the reader reaches the bottom.
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  return (
    <div ref={ref} className="pt-2">
      <button
        type="button"
        onClick={() => void loadMore()}
        disabled={state.loadingMore}
        className="tap flex w-full items-center justify-center gap-2 rounded-xl border border-ink-800 py-2.5 text-xs font-semibold uppercase tracking-wide text-mist transition-colors hover:border-ink-700 hover:text-chalk disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
      >
        {state.loadingMore ? <><Loader2 className="size-3.5 animate-spin" /> Loading…</> : "Load older"}
      </button>
    </div>
  );
}

export function NotificationList({
  state,
  onNavigate,
  emptyAction,
}: {
  state: NotificationsState;
  /** Called after a row is opened — the sheet uses it to close itself. */
  onNavigate?: () => void;
  emptyAction?: { href: string; label: string };
}) {
  if (state.groups === null) {
    return (
      <>
        <p role="status" className="sr-only">Loading notifications…</p>
        <NotificationSkeletonRows />
      </>
    );
  }

  if (state.groups.length === 0) {
    return (
      <EmptyState
        compact
        icon={<BellOff className="size-5" />}
        title={state.error ? "Couldn't load notifications" : "You're all caught up"}
        body={
          state.error
            ? "Something went wrong reaching the server. It'll retry on its own."
            : "Follow fighters, events, promotions and gyms and this is where their news lands."
        }
        action={state.error ? undefined : emptyAction ?? { href: "/fighters", label: "Find fighters" }}
      />
    );
  }

  return (
    <>
      {/* The one place unread changes are ANNOUNCED. Polite, so it waits for a
          screen reader to finish rather than interrupting mid-sentence — a
          notification arriving is not worth cutting someone off. */}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {state.unread === 0 ? "No unread notifications" : `${state.unread} unread notifications`}
      </p>

      <ul className="flex flex-col gap-2">
        {state.groups.map((g) => (
          <GroupRow
            key={g.id}
            group={g}
            onRead={state.markRead}
            onRemove={state.remove}
            onNavigate={onNavigate}
          />
        ))}
      </ul>

      {state.hasMore && <LoadMore state={state} />}
    </>
  );
}
