"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  CATEGORY_LABEL, STATUS_LABEL, STATUS_TONE,
  isCategory, isStatus,
} from "@/lib/feedback/shared";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  One row of the board, and the vote control.
//
//  ── Optimistic, but the server is the authority ───────────────────────────
//  The count moves the instant you tap, because a vote that takes a round-trip
//  to acknowledge feels broken. What comes back is the COUNTED number of rows,
//  and that overwrites the guess — so a double-tap, a retry, a stale tab or two
//  devices at once all converge on the truth rather than drifting from it.
//
//  `busy` blocks re-entry for the in-flight request, and both verbs are
//  idempotent server-side, so the failure mode of a fast double-click is "one
//  vote", not "two" and not a 500.
// ════════════════════════════════════════════════════════════════════════════

export interface FeedbackCardItem {
  id: string;
  title: string;
  body: string;
  category: string;
  status: string;
  publicNote?: string | null;
  createdAt: Date | string;
  author: { username: string | null; name: string | null; image: string | null } | null;
  _count: { votes: number };
  viewerVoted?: boolean;
}

function relative(d: Date | string): string {
  const then = new Date(d).getTime();
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function FeedbackCard({ item, canVote }: { item: FeedbackCardItem; canVote: boolean }) {
  const router = useRouter();
  const [votes, setVotes] = useState(item._count.votes);
  const [voted, setVoted] = useState(Boolean(item.viewerVoted));
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const category = isCategory(item.category) ? CATEGORY_LABEL[item.category] : item.category;
  const status = isStatus(item.status) ? STATUS_LABEL[item.status] : item.status;
  const tone = isStatus(item.status) ? STATUS_TONE[item.status] : "neutral";

  async function toggle() {
    if (!canVote) { router.push("/account"); return; }
    if (busy) return;
    setBusy(true);

    const next = !voted;
    // Optimistic.
    setVoted(next);
    setVotes((n) => n + (next ? 1 : -1));

    try {
      const res = await fetch(`/api/feedback/${item.id}/vote`, { method: next ? "POST" : "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { voted: boolean; count: number };
      // The server's count wins, always.
      setVoted(data.voted);
      setVotes(data.count);
      startTransition(() => router.refresh());
    } catch {
      // Put it back. A vote that silently did not happen is worse than one that
      // visibly did not.
      setVoted(!next);
      setVotes((n) => n + (next ? -1 : 1));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="flex items-start gap-3 rounded-card border border-ink-800 bg-ink-900 p-3.5 transition-colors hover:border-ink-700">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={voted}
        // The glyph alone says nothing to a screen reader, and "upvote" alone
        // says nothing about WHICH idea when there are twenty on the page.
        aria-label={voted ? `Remove your upvote from ${item.title}` : `Upvote ${item.title}`}
        className={cn(
          "tap grid w-14 shrink-0 place-items-center gap-0.5 rounded-lg border py-2 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blood-500/60",
          voted
            ? "border-blood-500 bg-blood-500/15 text-blood-300"
            : "border-ink-700 bg-ink-850 text-mist hover:border-ink-600 hover:text-chalk",
          busy && "opacity-60",
        )}
      >
        <ChevronUp className="size-4" aria-hidden />
        <span className="font-display text-sm font-black tabular-nums">{votes}</span>
      </button>

      <div className="min-w-0 flex-1">
        <Link href={`/feedback/${item.id}`} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blood-500/60">
          <h3 className="font-display text-sm font-bold leading-snug text-chalk">{item.title}</h3>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-mist">{item.body}</p>
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge tone="outline" size="sm">{category}</Badge>
          <Badge tone={tone} size="sm">{status}</Badge>
          <span className="text-2xs text-fog">
            {item.author?.username ? (
              <Link href={`/u/${item.author.username}`} className="hover:text-mist">@{item.author.username}</Link>
            ) : (
              "Someone"
            )}
            {" · "}
            {relative(item.createdAt)}
          </span>
        </div>
        {item.publicNote && (
          <p className="mt-2 rounded-lg border border-ink-800 bg-ink-950/60 px-2.5 py-1.5 text-2xs text-mist">
            {item.publicNote}
          </p>
        )}
      </div>
    </article>
  );
}
