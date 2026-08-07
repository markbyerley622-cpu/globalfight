"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BadgeCheck, Check, CheckCheck, Search, X } from "lucide-react";
import { ForumAvatar } from "@/components/forums/user-identity";
import { PresenceDot } from "@/components/presence/presence-dot";
import { useHeartbeat } from "@/lib/presence/use-presence";
import { deliveryOf } from "@/lib/presence/derive";
import { byInboxPriority, type ConversationSummary } from "@/lib/messages/types";
import { timeAgo, cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  The inbox.
//
//  ── Why this is a client component now ────────────────────────────────────
//  It was server-rendered, which meant everything on it was frozen at page
//  load: somebody could be typing you a reply and the inbox would say nothing
//  until you navigated. An inbox is the surface where "is anything happening?"
//  is the entire question, so it has to be able to answer it while you look at
//  it.
//
//  The server still renders the FIRST list (no spinner, no layout shift, and it
//  works with JavaScript off); this takes over from there.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Poll cadence.
 *
 * Faster than the map's minute because typing has a 7-second TTL — a slower
 * poll would mean the indicator expires before it is ever displayed — and
 * slower than the open thread's 3s, because an inbox is a glance rather than a
 * conversation. Pauses entirely while the tab is hidden.
 */
const POLL_MS = 8000;

/**
 * The Unicode combining-diacritic block, built from ESCAPES.
 *
 * Written as `new RegExp` with `\u` escapes rather than as a literal character
 * class, because the literal form contains invisible combining marks: they do
 * not survive a copy-paste reliably, an editor may normalise them away, and if
 * one is lost this silently becomes a no-op that nobody notices — search still
 * "works", it just stops matching accented names.
 */
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

/** Fold accents and case so "mendez" finds "Méndez". */
const fold = (s: string) =>
  s.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();

/**
 * Loose subsequence match: "jrod" finds "Jorge Rodriguez".
 *
 * Deliberately not a fuzzy-distance library. On a list of at most a few dozen
 * names, in-order character matching is what people actually do when they type
 * initials, it never returns a surprising result the way edit-distance does,
 * and it costs nothing.
 */
function matches(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const h = fold(haystack);
  const n = fold(needle);
  if (h.includes(n)) return true;
  let i = 0;
  for (const ch of h) {
    if (ch === n[i]) i++;
    if (i === n.length) return true;
  }
  return false;
}

export function InboxList({ initial }: { initial: ConversationSummary[] }) {
  const [rows, setRows] = useState(initial);
  const [query, setQuery] = useState("");

  // Being IN the inbox is presence. Without this, somebody sitting on their
  // message list would read as offline to everyone waiting on them.
  useHeartbeat();

  // A fresh server render must win over whatever the poll last wrote. Adjusted
  // during render, which is React's documented way to reset state on a prop
  // change — an effect would paint the stale list for a frame first.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setRows(initial);
  }

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      try {
        const res = await fetch("/api/messages", { cache: "no-store" });
        if (!res.ok || !alive) return;
        const data = (await res.json()) as { conversations: ConversationSummary[] };
        setRows(data.conversations);
      } catch {
        // A dropped poll is not something to tell the reader about — the list
        // they are looking at is still their inbox, just a few seconds older.
      }
    };

    const start = () => { if (!timer) timer = setInterval(tick, POLL_MS); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVisibility = () => {
      // Catch up IMMEDIATELY on return rather than waiting out an interval, so
      // the first visible frame is current instead of eight seconds stale.
      if (document.visibilityState === "visible") { void tick(); start(); } else stop();
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const listed = useMemo(() => {
    const q = query.trim();
    // Re-sorted on the CLIENT with the same comparator the server used, because
    // typing state changes between polls and a list that only sorted on the
    // server would leave somebody's live "typing…" sitting in fourth place.
    const filtered = q
      ? rows.filter((c) =>
          matches(c.withUser.name, q) || matches(c.withUser.username ?? "", q))
      : rows;
    return [...filtered].sort(byInboxPriority);
  }, [rows, query]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fog" aria-hidden />
        <label htmlFor="dm-search" className="sr-only">Search conversations</label>
        <input
          id="dm-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or @handle"
          className="w-full rounded-lg border border-ink-700 bg-ink-900 py-2.5 pl-9 pr-9 text-sm text-chalk placeholder:text-fog focus:border-blood-500/60 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="tap absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-fog hover:text-chalk"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {listed.length === 0 ? (
        <p className="rounded-card border border-ink-800 bg-ink-900/40 px-4 py-6 text-center text-sm text-fog">
          No conversation matches &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <ul className="divide-y divide-ink-800 overflow-hidden rounded-card border border-ink-800 bg-ink-900/40">
          {listed.map((c) => (
            <li key={c.id}>
              <InboxRow c={c} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InboxRow({ c }: { c: ConversationSummary }) {
  const unread = c.unread > 0;

  // The receipt for MY last message, shown inline on the preview line. Only
  // meaningful when the last message is mine — a tick beside their message
  // would be claiming something about my own reading.
  const mineLast = c.lastMessage?.fromMe === true;
  const receipt = mineLast && c.lastMessage
    ? deliveryOf({
        at: c.lastMessage.at,
        optimistic: false,
        otherDeliveredAt: c.otherDeliveredAt,
        otherReadAt: c.otherReadAt,
      })
    : null;

  return (
    <Link
      href={`/messages/${c.id}`}
      className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-ink-800/60"
    >
      <span className="relative shrink-0">
        <ForumAvatar name={c.withUser.name} image={c.withUser.image} size="lg" />
        <PresenceDot lastSeenAt={c.withUser.lastSeenAt} />
        {unread && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 grid min-w-[1.15rem] place-items-center rounded-full border-2 border-ink-900 bg-blood-500 px-1 text-3xs font-bold tabular-nums text-white"
          >
            {c.unread > 9 ? "9+" : c.unread}
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1">
            <span className={cn("truncate font-display text-sm", unread ? "font-black text-white" : "font-bold text-chalk")}>
              {c.withUser.name}
            </span>
            {c.withUser.verified && (
              <BadgeCheck className="size-3.5 shrink-0 text-volt-400" aria-label="Verified" />
            )}
          </span>
          <span className={cn("shrink-0 text-3xs tabular-nums", unread ? "font-bold text-blood-300" : "text-fog")}>
            {timeAgo(c.lastMessageAt)}
          </span>
        </span>

        {/* Typing REPLACES the preview rather than sitting beside it. The last
            message is history; "they are writing to you right now" is the only
            thing on this row that is happening. */}
        {c.otherTyping ? (
          <span className="mt-0.5 flex items-center gap-1.5" role="status" aria-live="polite">
            <span className="sr-only">{c.withUser.name} is typing</span>
            <span aria-hidden className="cr-typing-dot" />
            <span aria-hidden className="cr-typing-dot" />
            <span aria-hidden className="cr-typing-dot" />
            <span aria-hidden className="text-xs font-semibold text-volt-400">typing…</span>
          </span>
        ) : (
          <span className={cn("mt-0.5 flex items-center gap-1 text-xs", unread ? "font-semibold text-mist" : "text-fog")}>
            {receipt === "sent" && <Check className="size-3 shrink-0" aria-hidden />}
            {(receipt === "delivered" || receipt === "read") && (
              <CheckCheck className={cn("size-3 shrink-0", receipt === "read" && "text-volt-400")} aria-hidden />
            )}
            <span className="truncate">
              {c.lastMessage
                ? `${c.lastMessage.fromMe && !receipt ? "You: " : ""}${c.lastMessage.body}`
                : "No messages yet"}
            </span>
          </span>
        )}
      </span>
    </Link>
  );
}
