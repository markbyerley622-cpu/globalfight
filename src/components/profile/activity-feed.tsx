"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity as ActivityIcon, Lock, Repeat, Check, X, Trophy, TrendingUp,
  UserPlus, MessageSquare, Swords, Award, Loader2,
} from "lucide-react";
import type { ActivityItem } from "@/lib/activity/read";
import { timeAgo } from "@/lib/utils";
import { ProfileSection } from "./profile-section";

/**
 * THE ACTIVITY FEED.
 *
 * A profile's accuracy answers "are they good"; this answers "are they here".
 * A member with three settled picks has almost nothing to show under Recent
 * Results, and the feed is what makes that profile worth following anyway —
 * which is exactly why the emitters that only fired on RESOLUTION left new
 * accounts looking abandoned.
 *
 * The sentence and its destination are resolved at write time (see the Activity
 * model), so rendering is a map with no lookups: whatever kinds get added later,
 * this component does not change. All it owns is the icon and the tone.
 */

/** Icon + tone per kind. The ONE place presentation is decided. */
const LOOK: Record<string, { icon: typeof Lock; tone: string }> = {
  PICK_MADE: { icon: Lock, tone: "text-blood-300" },
  PICK_CHANGED: { icon: Repeat, tone: "text-mist" },
  PICK_CORRECT: { icon: Check, tone: "text-up" },
  PICK_MISSED: { icon: X, tone: "text-fog" },
  CARD_EARNED: { icon: Trophy, tone: "text-gold-400" },
  REP_MILESTONE: { icon: TrendingUp, tone: "text-volt-400" },
  FOLLOW: { icon: UserPlus, tone: "text-volt-400" },
  THREAD_CREATED: { icon: MessageSquare, tone: "text-mist" },
  POST_CREATED: { icon: MessageSquare, tone: "text-fog" },
  CHALLENGE_SENT: { icon: Swords, tone: "text-blood-300" },
  CHALLENGE_ACCEPTED: { icon: Swords, tone: "text-blood-300" },
  BATTLE_WON: { icon: Trophy, tone: "text-gold-400" },
  BADGE_EARNED: { icon: Award, tone: "text-gold-400" },
};
// An unknown kind must render, not crash — a feed row written by a newer deploy
// than the one serving this page is a normal state during a rollout.
const FALLBACK = { icon: ActivityIcon, tone: "text-fog" };

export function ActivityFeed({
  initialItems, initialCursor, username, isSelf,
}: {
  initialItems: ActivityItem[];
  initialCursor: string | null;
  /** Whose feed — the API is public, so this is the subject, not the viewer. */
  username: string;
  isSelf: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!cursor || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(username)}/activity?cursor=${encodeURIComponent(cursor)}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      // Appended, never replaced: the cursor guarantees these are strictly older
      // than what is already on screen, so there is nothing to de-duplicate.
      setItems((prev) => [...prev, ...(data.items ?? [])]);
      setCursor(data.nextCursor ?? null);
    } catch {
      setError("Couldn't load more. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) {
    return (
      <ProfileSection title="Activity" icon={<ActivityIcon className="size-4" />}>
        <p className="rounded-card border border-dashed border-ink-700 bg-ink-900/40 px-4 py-8 text-center text-sm text-fog">
          {isSelf
            ? "Nothing yet. Lock a pick, follow someone or join a thread and it shows up here."
            : "Nothing yet — their activity will appear here."}
        </p>
      </ProfileSection>
    );
  }

  return (
    <ProfileSection title="Activity" icon={<ActivityIcon className="size-4" />}>
      <ol className="relative space-y-0">
        {items.map((a, i) => {
          const look = LOOK[a.type] ?? FALLBACK;
          const Icon = look.icon;
          const last = i === items.length - 1;
          const body = (
            <>
              {/* The rail — a continuous line through the icons, so the feed
                  reads as one timeline rather than a stack of separate rows. */}
              <span className="relative flex flex-col items-center">
                <span className={`grid size-7 shrink-0 place-items-center rounded-full border border-ink-700 bg-ink-900 ${look.tone}`}>
                  <Icon className="size-3.5" aria-hidden />
                </span>
                {!last && <span className="w-px flex-1 bg-ink-800" aria-hidden />}
              </span>
              <span className="min-w-0 flex-1 pb-4">
                <span className="block text-sm leading-snug text-chalk">{a.title}</span>
                <time dateTime={a.createdAt} className="mt-0.5 block text-2xs text-fog">
                  {timeAgo(a.createdAt)}
                </time>
              </span>
            </>
          );
          return (
            <li key={a.id} className="flex gap-3">
              {a.url ? (
                <Link
                  href={a.url}
                  className="flex flex-1 gap-3 rounded-lg transition-colors hover:bg-ink-900/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
                >
                  {body}
                </Link>
              ) : (
                <span className="flex flex-1 gap-3">{body}</span>
              )}
            </li>
          );
        })}
      </ol>

      {error && (
        <p role="alert" className="mt-2 text-center text-2xs text-blood-300">{error}</p>
      )}

      {/* CURSOR pagination — "everything older than this row". Offset paging
          would drift as new activity arrives at the head. */}
      {cursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={busy}
          className="tap mx-auto mt-2 flex min-h-11 items-center gap-2 rounded-lg border border-ink-700 bg-ink-900/60 px-4 py-2 text-xs font-semibold text-mist transition-colors hover:border-blood-500/40 hover:text-blood-300 disabled:opacity-60"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {busy ? "Loading…" : "Load more"}
        </button>
      )}
    </ProfileSection>
  );
}
