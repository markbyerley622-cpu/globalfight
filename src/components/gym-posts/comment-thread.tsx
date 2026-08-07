"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { Heart, Loader2, MessageSquare, Trash2 } from "lucide-react";
import type { GymPostCommentDTO } from "@/lib/gym-posts/types";
import { MAX_COMMENT_CHARS } from "@/lib/gym-posts/types";
import { timeAgo } from "@/lib/utils";
import { CommentSkeleton } from "./skeletons";
import { Composer } from "@/components/composer/composer";

// ════════════════════════════════════════════════════════════════════════════
//  Comments under a post.
//
//  ── Optimism, and the one rule that keeps it honest ──────────────────────
//  A comment appears the instant it is written, under a temporary id, and is
//  REPLACED by the server's row when the request returns. If the request fails
//  the temporary row is removed and the text goes back into the box — never
//  lost, and never left on screen pretending to be published. An optimistic UI
//  that swallows the text on failure is worse than a spinner.
//
//  ── Lazy by default ──────────────────────────────────────────────────────
//  Comments are not fetched until the thread is opened. A feed page carrying
//  twenty posts would otherwise fire twenty comment requests to render text
//  nobody has asked to read; the card shows the COUNT, which it already has.
// ════════════════════════════════════════════════════════════════════════════

interface Props {
  postId: string;
  /** Rendered before anything is fetched. */
  initialCount: number;
  signedIn: boolean;
  onCountChange?: (count: number) => void;
}

/** Temporary client-side id for a comment that has not been acknowledged yet. */
const tempId = () => `tmp_${Math.random().toString(36).slice(2)}`;

export function CommentThread({ postId, initialCount, signedIn, onCountChange }: Props) {
  const [items, setItems] = useState<GymPostCommentDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<GymPostCommentDTO | null>(null);
  const [, startTransition] = useTransition();

  const load = useCallback(
    async (next?: string | null) => {
      setBusy(true);
      setError(null);
      try {
        const qs = next ? `?cursor=${encodeURIComponent(next)}` : "";
        const res = await fetch(`/api/gym/posts/${postId}/comments${qs}`);
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { items: GymPostCommentDTO[]; nextCursor: string | null };
        // Appended, never merged: the cursor guarantees these are strictly newer
        // than what is on screen, so there is nothing to de-duplicate.
        setItems((prev) => (next ? [...prev, ...data.items] : data.items));
        setCursor(data.nextCursor);
        setLoaded(true);
      } catch {
        setError("Couldn't load the replies.");
      } finally {
        setBusy(false);
      }
    },
    [postId],
  );

  useEffect(() => { void load(null); }, [load]);

  // Optional event: the form passes one, the Composer's Enter handler does not.
  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || !signedIn) return;

    const optimistic: GymPostCommentDTO = {
      id: tempId(),
      postId,
      parentId: replyTo?.parentId ?? replyTo?.id ?? null,
      author: { id: "me", name: "You", username: null, image: null, registryRole: "fan" },
      body,
      reactionCount: 0,
      myReactions: [],
      createdAt: new Date().toISOString(),
      editedAt: null,
      deleted: false,
      canEdit: true,
      canDelete: true,
    };
    setItems((prev) => [...prev, optimistic]);
    setDraft("");
    setReplyTo(null);
    onCountChange?.(items.length + 1);

    try {
      const res = await fetch(`/api/gym/posts/${postId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, parentId: optimistic.parentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Couldn't post that.");
      setItems((prev) => prev.map((c) => (c.id === optimistic.id ? data.comment : c)));
    } catch (err) {
      // Roll back AND give the words back. Losing what someone typed is the one
      // failure mode an optimistic UI must never have.
      setItems((prev) => prev.filter((c) => c.id !== optimistic.id));
      setDraft(body);
      onCountChange?.(items.length);
      setError(err instanceof Error ? err.message : "Couldn't post that.");
    }
  }

  async function react(comment: GymPostCommentDTO) {
    if (!signedIn || comment.id.startsWith("tmp_")) return;
    const liked = comment.myReactions.includes("like");
    // Applied immediately; a tap that waits for a round-trip feels broken.
    setItems((prev) =>
      prev.map((c) =>
        c.id === comment.id
          ? {
              ...c,
              reactionCount: c.reactionCount + (liked ? -1 : 1),
              myReactions: liked ? c.myReactions.filter((t) => t !== "like") : [...c.myReactions, "like"],
            }
          : c,
      ),
    );
    try {
      const res = await fetch(`/api/gym/posts/${postId}/reactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commentId: comment.id, type: "like" }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      // Reconcile against the SERVER's tally rather than trusting the optimistic
      // arithmetic — two devices tapping at once would otherwise drift.
      setItems((prev) =>
        prev.map((c) =>
          c.id === comment.id
            ? { ...c, reactionCount: data.reactionCount, myReactions: data.myReactions }
            : c,
        ),
      );
    } catch {
      setItems((prev) => prev.map((c) => (c.id === comment.id ? comment : c)));
    }
  }

  async function remove(comment: GymPostCommentDTO) {
    if (comment.id.startsWith("tmp_")) return;
    const snapshot = items;
    setItems((prev) => prev.map((c) => (c.id === comment.id ? { ...c, deleted: true, body: "" } : c)));
    try {
      const res = await fetch(
        `/api/gym/posts/${postId}/comments?commentId=${encodeURIComponent(comment.id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error();
      onCountChange?.(Math.max(0, items.filter((c) => !c.deleted).length - 1));
    } catch {
      setItems(snapshot);
      setError("Couldn't delete that.");
    }
  }

  const top = items.filter((c) => !c.parentId);
  const repliesOf = (id: string) => items.filter((c) => c.parentId === id);

  return (
    <div className="mt-3 border-t border-ink-800 pt-3">
      {!loaded && busy && (
        <>
          <CommentSkeleton />
          <CommentSkeleton />
        </>
      )}

      {loaded && items.length === 0 && (
        <p className="py-2 text-xs text-fog">
          {initialCount > 0 ? "These replies have been removed." : "No replies yet."}
        </p>
      )}

      <ol className="flex flex-col">
        {top.map((c) => (
          <li key={c.id}>
            <CommentRow comment={c} onReact={react} onReply={setReplyTo} onDelete={remove} signedIn={signedIn} />
            {repliesOf(c.id).length > 0 && (
              <ol className="ml-9 border-l border-ink-800 pl-3">
                {repliesOf(c.id).map((r) => (
                  <li key={r.id}>
                    <CommentRow comment={r} onReact={react} onReply={setReplyTo} onDelete={remove} signedIn={signedIn} />
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ol>

      {cursor && (
        <button
          type="button"
          onClick={() => startTransition(() => { void load(cursor); })}
          disabled={busy}
          className="tap mt-1 flex min-h-9 items-center gap-1.5 text-xs font-semibold text-mist transition-colors hover:text-blood-300 disabled:opacity-60"
        >
          {busy && <Loader2 className="size-3 animate-spin" aria-hidden />}
          Show older replies
        </button>
      )}

      {error && <p role="alert" className="mt-1.5 text-2xs text-blood-300">{error}</p>}

      {signedIn ? (
        <form onSubmit={submit} className="mt-2.5">
          {replyTo && (
            <p className="mb-1.5 flex items-center gap-2 text-2xs text-fog">
              Replying to {replyTo.author.name}
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="tap font-semibold text-blood-300 underline-offset-2 hover:underline"
              >
                cancel
              </button>
            </p>
          )}
          <div className="flex items-end gap-2">
            {/* Chat-like: a comment is one or two lines, so Enter sends. The
                limit is enforced by the Composer on input rather than by a
                slice in this handler. */}
            <Composer
              value={draft}
              onChange={setDraft}
              onSubmit={() => void submit()}
              submitOnEnter
              maxLength={MAX_COMMENT_CHARS}
              showCount
              rows={1}
              placeholder={replyTo ? "Write a reply…" : "Add a comment…"}
              aria-label="Write a comment"
              draftKey={`gym-comment:${postId}:${replyTo ?? "root"}`}
              className="min-h-11 w-full resize-y rounded-lg border border-ink-700 bg-ink-950 px-3 py-2.5 text-sm text-chalk placeholder:text-fog focus:border-blood-500/50 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="tap min-h-11 shrink-0 rounded-lg bg-blood-500/90 px-4 text-xs font-bold uppercase tracking-wide text-chalk transition-colors hover:bg-blood-500 disabled:opacity-40"
            >
              Reply
            </button>
          </div>
        </form>
      ) : (
        <p className="mt-2 text-xs text-fog">
          <Link href="/signin" className="font-semibold text-blood-300 underline-offset-2 hover:underline">
            Sign in
          </Link>{" "}
          to join the conversation.
        </p>
      )}
    </div>
  );
}

function CommentRow({
  comment, onReact, onReply, onDelete, signedIn,
}: {
  comment: GymPostCommentDTO;
  onReact: (c: GymPostCommentDTO) => void;
  onReply: (c: GymPostCommentDTO) => void;
  onDelete: (c: GymPostCommentDTO) => void;
  signedIn: boolean;
}) {
  // A removed comment stays as a tombstone. Dropping it would leave its replies
  // answering nothing.
  if (comment.deleted) {
    return <p className="py-2 pl-9 text-xs italic text-fog">This comment was removed.</p>;
  }

  const liked = comment.myReactions.includes("like");
  const pending = comment.id.startsWith("tmp_");

  return (
    <div className={`flex gap-2.5 py-2 ${pending ? "opacity-60" : ""}`}>
      <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full border border-ink-700 bg-ink-900">
        {comment.author.image ? (
          <Image src={comment.author.image} alt="" width={28} height={28} className="size-full object-cover" unoptimized />
        ) : (
          <span className="font-display text-2xs font-black text-fog">
            {comment.author.name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          {comment.author.username ? (
            <Link
              href={`/u/${comment.author.username}`}
              className="text-xs font-semibold text-chalk underline-offset-2 hover:underline"
            >
              {comment.author.name}
            </Link>
          ) : (
            <span className="text-xs font-semibold text-chalk">{comment.author.name}</span>
          )}
          <time dateTime={comment.createdAt} className="text-2xs text-fog">
            {timeAgo(comment.createdAt)}
            {comment.editedAt && " · edited"}
          </time>
        </p>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-mist">
          {comment.body}
        </p>

        <div className="mt-1 flex items-center gap-3">
          <button
            type="button"
            onClick={() => onReact(comment)}
            disabled={!signedIn || pending}
            aria-pressed={liked}
            aria-label={liked ? "Remove like" : "Like this comment"}
            className={`tap flex min-h-9 items-center gap-1 text-2xs font-semibold transition-colors disabled:opacity-40 ${
              liked ? "text-blood-300" : "text-fog hover:text-mist"
            }`}
          >
            <Heart className={`size-3.5 ${liked ? "fill-current" : ""}`} aria-hidden />
            {comment.reactionCount > 0 && <span className="tabular-nums">{comment.reactionCount}</span>}
          </button>
          {signedIn && !pending && (
            <button
              type="button"
              onClick={() => onReply(comment)}
              className="tap flex min-h-9 items-center gap-1 text-2xs font-semibold text-fog transition-colors hover:text-mist"
            >
              <MessageSquare className="size-3.5" aria-hidden /> Reply
            </button>
          )}
          {comment.canDelete && !pending && (
            <button
              type="button"
              onClick={() => onDelete(comment)}
              className="tap flex min-h-9 items-center gap-1 text-2xs font-semibold text-fog transition-colors hover:text-blood-300"
            >
              <Trash2 className="size-3.5" aria-hidden /> Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
