"use client";

import { memo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  BadgeCheck, Heart, Flame, Handshake, Laugh, MessageSquare, Share2, Trash2, Lock, Users, Pin,
} from "lucide-react";
import type { GymPostDTO, ReactionType } from "@/lib/gym-posts/types";
import { REACTION_TYPES } from "@/lib/gym-posts/types";
import { timeAgo } from "@/lib/utils";
import { ReportButton } from "@/components/forums/report-dialog";
import { MediaCarousel } from "./media-carousel";
import { CommentThread } from "./comment-thread";

// ════════════════════════════════════════════════════════════════════════════
//  One post.
//
//  ── memo, and why it earns its keep here ─────────────────────────────────
//  A feed holds its posts in one array in one parent. Without memo, liking post
//  three re-renders all twenty — including twenty <Image> trees — on the main
//  thread, while the reader is mid-scroll. The props are stable references and
//  the comparison is shallow, so this is cheap and the win is real.
//
//  ── What the card does NOT decide ────────────────────────────────────────
//  Whether the viewer may edit, delete or see this post. Those arrive as
//  `canEdit` / `canDelete` from the server. A UI that re-derives permission
//  from the ids it happens to hold is a UI that eventually disagrees with the
//  API, and the version that shows a button the server refuses is the one users
//  report as broken.
// ════════════════════════════════════════════════════════════════════════════

const REACTION_LOOK: Record<ReactionType, { icon: typeof Heart; label: string; tone: string }> = {
  like: { icon: Heart, label: "Like", tone: "text-blood-300" },
  fire: { icon: Flame, label: "Fire", tone: "text-gold-300" },
  respect: { icon: Handshake, label: "Respect", tone: "text-volt-400" },
  laugh: { icon: Laugh, label: "Funny", tone: "text-mist" },
};

interface Props {
  post: GymPostDTO;
  signedIn: boolean;
  /** Hide the gym line — redundant on a gym's own page. */
  hideGym?: boolean;
  /** Eager-load the first image. Only ever true for the first card. */
  priority?: boolean;
  onChange: (post: GymPostDTO) => void;
  onDelete: (id: string) => void;
}

function Card({ post, signedIn, hideGym, priority, onChange, onDelete }: Props) {
  const [showComments, setShowComments] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState(false);

  async function react(type: ReactionType) {
    if (!signedIn) return;
    const had = post.myReactions.includes(type);

    // Applied before the request. A reaction that waits for a round-trip reads
    // as a dropped tap, and people tap again — which then toggles it back off.
    onChange({
      ...post,
      reactionCount: post.reactionCount + (had ? -1 : 1),
      myReactions: had ? post.myReactions.filter((t) => t !== type) : [...post.myReactions, type],
      reactions: { ...post.reactions, [type]: Math.max(0, (post.reactions[type] ?? 0) + (had ? -1 : 1)) },
    });

    try {
      const res = await fetch(`/api/gym/posts/${post.id}/reactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      // Reconcile with the server's tally. The optimistic arithmetic is a guess
      // about a shared counter, and two people tapping at once make it wrong.
      onChange({
        ...post,
        reactionCount: data.reactionCount,
        reactions: data.reactions,
        myReactions: data.myReactions,
      });
    } catch {
      onChange(post);
      setError("That didn't register. Try again.");
    }
  }

  async function share() {
    const url = `${window.location.origin}/gyms/${post.gym.slug}?post=${post.id}`;
    try {
      if (navigator.share) await navigator.share({ url, title: `${post.gym.name} on Combat Reviews` });
      else await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 1800);
    } catch {
      // A cancelled share sheet throws. That is not an error and must not be
      // reported as one — but it also must not increment the count.
      return;
    }
    // Counted only AFTER the share actually happened.
    try {
      const res = await fetch(`/api/gym/posts/${post.id}/share`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        onChange({ ...post, shareCount: data.shareCount });
      }
    } catch {
      // The share succeeded; failing to count it is not worth an error message.
    }
  }

  async function remove() {
    if (!confirm("Delete this post? Its photos are released too.")) return;
    const res = await fetch(`/api/gym/posts/${post.id}`, { method: "DELETE" });
    if (res.ok) onDelete(post.id);
    else setError("Couldn't delete that.");
  }

  return (
    <article className="card-surface p-4" aria-labelledby={`post-${post.id}-author`}>
      <header className="flex items-start gap-3">
        <Link
          href={post.author.username ? `/u/${post.author.username}` : `/gyms/${post.gym.slug}`}
          className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full border border-ink-700 bg-ink-900"
        >
          {post.author.image ? (
            <Image src={post.author.image} alt="" width={36} height={36} className="size-full object-cover" unoptimized />
          ) : (
            <span className="font-display text-xs font-black text-fog">
              {post.author.name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </Link>

        <div className="min-w-0 flex-1">
          <p id={`post-${post.id}-author`} className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-chalk">{post.author.name}</span>
            <time dateTime={post.createdAt} className="text-2xs text-fog">
              {timeAgo(post.createdAt)}
              {post.editedAt && " · edited"}
            </time>
          </p>
          {!hideGym && (
            <Link
              href={`/gyms/${post.gym.slug}`}
              className="mt-0.5 inline-flex items-center gap-1 text-2xs text-fog underline-offset-2 hover:text-mist hover:underline"
            >
              {post.gym.name}
              {post.gym.verified && <BadgeCheck className="size-3 text-volt-400" aria-label="Verified gym" />}
            </Link>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {post.pinned && (
            <span className="inline-flex items-center gap-1 rounded-md bg-gold-500/12 px-1.5 py-0.5 text-2xs font-semibold uppercase text-gold-300">
              <Pin className="size-3" aria-hidden /> Pinned
            </span>
          )}
          {/* Visibility is shown, not implied. Someone posting to members only
              needs to SEE that it is members only, every time they look at it. */}
          {post.visibility !== "PUBLIC" && (
            <span className="inline-flex items-center gap-1 rounded-md bg-ink-800 px-1.5 py-0.5 text-2xs font-semibold uppercase text-fog">
              {post.visibility === "MEMBERS" ? <Users className="size-3" aria-hidden /> : <Lock className="size-3" aria-hidden />}
              {post.visibility === "MEMBERS" ? "Members" : "Private"}
            </span>
          )}
        </div>
      </header>

      {post.body && (
        <p className="mt-2.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-mist">
          {post.body}
        </p>
      )}

      <MediaCarousel media={post.media} priority={priority} />

      <footer className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-ink-800 pt-2">
        {REACTION_TYPES.map((type) => {
          const look = REACTION_LOOK[type];
          const Icon = look.icon;
          const mine = post.myReactions.includes(type);
          const count = post.reactions[type] ?? 0;
          // Unused reactions stay hidden behind "like" until someone uses one:
          // four buttons on every card is clutter, and the count is the signal.
          if (type !== "like" && count === 0 && !mine) return null;
          return (
            <button
              key={type}
              type="button"
              onClick={() => react(type)}
              disabled={!signedIn}
              aria-pressed={mine}
              aria-label={mine ? `Remove ${look.label.toLowerCase()}` : look.label}
              className={`tap flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
                mine ? look.tone : "text-fog hover:text-mist"
              }`}
            >
              <Icon className={`size-4 ${mine ? "fill-current" : ""}`} aria-hidden />
              {count > 0 && <span className="tabular-nums">{count}</span>}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setShowComments((v) => !v)}
          aria-expanded={showComments}
          className="tap flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-fog transition-colors hover:text-mist"
        >
          <MessageSquare className="size-4" aria-hidden />
          {post.commentCount > 0 && <span className="tabular-nums">{post.commentCount}</span>}
        </button>

        {post.visibility === "PUBLIC" && (
          <button
            type="button"
            onClick={share}
            className="tap flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-fog transition-colors hover:text-mist"
          >
            <Share2 className="size-4" aria-hidden />
            {shared ? <span className="text-up">Copied</span> : post.shareCount > 0 && <span className="tabular-nums">{post.shareCount}</span>}
          </button>
        )}

        <span className="flex-1" />

        {signedIn && <ReportButton targetType="gym_post" targetId={post.id} compact />}
        {post.canDelete && (
          <button
            type="button"
            onClick={remove}
            aria-label="Delete post"
            className="tap flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-fog transition-colors hover:text-blood-300"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        )}
      </footer>

      {error && <p role="alert" className="mt-1.5 text-2xs text-blood-300">{error}</p>}

      {showComments && (
        <CommentThread
          postId={post.id}
          initialCount={post.commentCount}
          signedIn={signedIn}
          onCountChange={(commentCount) => onChange({ ...post, commentCount })}
        />
      )}
    </article>
  );
}

export const GymPostCard = memo(Card);
