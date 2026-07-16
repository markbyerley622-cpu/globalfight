"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { MessageSquare, Share2, Pin, Loader2, Trash2, Eye } from "lucide-react";
import { timeAgo, cn } from "@/lib/utils";
import { KindBadge } from "@/components/forums/kind-badge";
import { RespectIcon, SaluteIcon } from "@/components/forums/emblems";
import type { ForumThreadDTO } from "@/lib/forum/types";

/**
 * Reddit-style post card, Combat Register flavour: RESPECT (closed fist) upvotes,
 * SALUTE (middle finger) downvotes. Tap the rail to vote; on mobile, double-tap
 * anywhere on the card to Respect (with a fist burst).
 *
 * NOTE: votes are optimistic + local — there's no thread-vote endpoint yet
 * (reactions live on posts). Starting score = the real reaction count. Wire a
 * POST /api/forums/threads/[slug]/vote route to persist (see TODO below).
 */
export function ThreadCard({
  thread, showCategory, canDelete, deleting, onDelete,
}: {
  thread: ForumThreadDTO;
  showCategory?: boolean;
  canDelete?: boolean;
  deleting?: boolean;
  onDelete?: () => void;
}) {
  const router = useRouter();
  const href = `/forums/${thread.categorySlug}/${thread.slug}`;

  const base = thread.reactionCount ?? 0;
  const [vote, setVote] = useState<0 | 1 | -1>(0); // 1 = respect, -1 = salute
  const [burst, setBurst] = useState(false);
  // Separate tallies: respect (green) and disrespect (red).
  const respectCount = base + (vote === 1 ? 1 : 0);
  const disrespectCount = vote === -1 ? 1 : 0;

  const lastTap = useRef(0);
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const respect = () => setVote((v) => (v === 1 ? 0 : 1));
  const salute = () => setVote((v) => (v === -1 ? 0 : -1));
  // TODO: persist — POST /api/forums/threads/${thread.slug}/vote { dir } when the route exists.

  function showBurst() {
    setBurst(true);
    window.setTimeout(() => setBurst(false), 550);
  }

  /** Touch: single tap → open (short delay), double tap → Respect. */
  function onTouchEnd(e: React.TouchEvent) {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      e.preventDefault();
      if (navTimer.current) clearTimeout(navTimer.current);
      lastTap.current = 0;
      setVote(1);
      showBurst();
    } else {
      lastTap.current = now;
      e.preventDefault();
      navTimer.current = setTimeout(() => router.push(href), 290);
    }
  }

  return (
    <li className="group relative flex overflow-hidden rounded-card border border-ink-700 bg-ink-900/40 transition-colors hover:border-blood-500/40">
      {/* vote rail — RESPECT (green count) over SALUTE (red count) */}
      <div className="flex w-11 shrink-0 flex-col items-center gap-0.5 border-r border-ink-800 bg-ink-950/40 py-2.5">
        <button
          type="button"
          aria-label="Respect"
          aria-pressed={vote === 1}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); respect(); }}
          className={cn(
            "rounded-md p-1 transition-all active:scale-90",
            vote === 1 ? "text-emerald-400" : "text-fog hover:bg-emerald-500/15 hover:text-emerald-400",
          )}
        >
          <RespectIcon className="size-6" filled={vote === 1} />
        </button>
        <span className={cn("text-xs font-bold tabular-nums", vote === 1 ? "text-emerald-400" : "text-emerald-300/70")}>
          {respectCount}
        </span>

        <span className="my-0.5 h-px w-4 bg-ink-800" />

        <button
          type="button"
          aria-label="Disrespect"
          aria-pressed={vote === -1}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); salute(); }}
          className={cn(
            "rounded-md p-1 transition-all active:scale-90",
            vote === -1 ? "text-blood-400" : "text-fog hover:bg-blood-500/15 hover:text-blood-400",
          )}
        >
          <SaluteIcon className="size-6" filled={vote === -1} />
        </button>
        <span className={cn("text-xs font-bold tabular-nums", vote === -1 ? "text-blood-400" : "text-blood-300/60")}>
          {disrespectCount}
        </span>
      </div>

      {/* body */}
      <Link href={href} onTouchEnd={onTouchEnd} className="flex min-w-0 flex-1 gap-3 p-2.5 sm:p-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.65rem]">
            {thread.pinned && <Pin className="size-3 shrink-0 text-gold-400" />}
            {showCategory && (
              <span className="rounded-full bg-ink-800 px-2 py-0.5 font-bold uppercase tracking-wider text-mist">
                r/{thread.categorySlug}
              </span>
            )}
            <KindBadge kind={thread.kind} />
            <span className="truncate text-fog">{thread.authorName} · {timeAgo(thread.lastPostAt)}</span>
          </div>

          <h3 className="font-display text-sm font-semibold leading-snug text-chalk group-hover:text-blood-300 sm:text-[0.95rem]">
            {thread.title}
          </h3>

          {thread.excerpt && <p className="line-clamp-2 text-xs text-fog">{thread.excerpt}</p>}

          <div className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-fog">
            <span className="flex items-center gap-1 rounded px-1.5 py-1 group-hover:bg-ink-800">
              <MessageSquare className="size-3.5" />{thread.replyCount} comments
            </span>
            <span className="flex items-center gap-1 rounded px-1.5 py-1 group-hover:bg-ink-800">
              <Share2 className="size-3.5" />Share
            </span>
            <span className="ml-auto flex items-center gap-1 text-[0.7rem]">
              <Eye className="size-3.5" />{thread.views}
            </span>
          </div>
        </div>

        {thread.previewImage && (
          <span className="relative hidden size-16 shrink-0 overflow-hidden rounded-md border border-ink-700 sm:block">
            <Image src={thread.previewImage} alt="" fill className="object-cover" sizes="64px" loading="lazy" />
          </span>
        )}
      </Link>

      {/* double-tap Respect burst */}
      {burst && (
        <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <RespectIcon className="size-16 animate-[salute_550ms_ease-out] text-emerald-500 drop-shadow-[0_0_12px_rgba(16,185,129,0.6)]" filled />
        </span>
      )}

      {canDelete && onDelete && (
        <button
          onClick={onDelete}
          disabled={deleting}
          aria-label="Delete thread"
          className={cn("absolute right-2 top-2 z-20 rounded-lg p-1.5 text-fog transition-colors hover:bg-blood-500/10 hover:text-blood-400 disabled:opacity-50")}
        >
          {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        </button>
      )}
    </li>
  );
}
