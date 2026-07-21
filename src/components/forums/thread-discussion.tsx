"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, Pencil, Trash2, Check, X, Wifi, Reply, Quote, CornerDownRight, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-client";
import { useT } from "@/lib/i18n";
import { useForumStream } from "@/lib/forum/use-forum-stream";
import { timeAgo, cn } from "@/lib/utils";
import { AuthorIdentity } from "@/components/forums/user-identity";
import { AttachmentGrid } from "@/components/forums/attachments";
import { ReactionBar } from "@/components/forums/reaction-bar";
import { ReportButton } from "@/components/forums/report-dialog";
import { MediaComposer } from "@/components/forums/media-composer";
import { RichText } from "@/components/forums/rich-text";
import { PickLine, RecordLine } from "@/components/forums/pick-identity";
import type { ForumPostDTO, Paginated, ForumAttachment } from "@/lib/forum/types";
import type { RoomIdentity } from "@/lib/community/room-types";

const PAGE_CAP = 12; // up to 12 pages (~360 posts) reconciled on realtime ticks
const MAX_DEPTH = 5; // visual nesting cap (keeps replies readable on mobile)

interface ReplyTarget { parentId: string | null; quotePostId: string | null; authorName: string; mention?: string | null; }

/**
 * ONE discussion component. It renders the forum, a fight's community room and a
 * private battle room — the difference is scope and context, never a fork.
 *
 * `identities` attaches each author's call on the bout (fighter · method ·
 * confidence) and their record against the viewer, so a room message carries
 * everything the debate needs. `onChallenge` turns a spectator into a rival.
 * `compact` tightens the rhythm for a room living inside a fight module.
 */
export function ThreadDiscussion({
  threadSlug, locked, threadAuthorId, categorySlug,
  identities, myCorner, onChallenge, compact = false, placeholder, emptyLabel,
}: {
  threadSlug: string; locked: boolean; threadAuthorId?: string; categorySlug?: string;
  /** Author id → their call on this bout + record vs the viewer (room mode). */
  identities?: Record<string, RoomIdentity>;
  /** The viewer's own corner — anyone on the other side is challengeable. */
  myCorner?: "RED" | "BLUE" | null;
  onChallenge?: (userId: string, name: string) => void;
  compact?: boolean;
  placeholder?: string;
  emptyLabel?: string;
}) {
  const { user } = useAuth();
  const t = useT();
  const router = useRouter();
  const [posts, setPosts] = useState<ForumPostDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canDeleteThread = !!user && !!threadAuthorId && user.id === threadAuthorId;

  async function deleteThread() {
    if (!confirm("Delete this thread? This removes it for everyone and can't be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/forums/threads/${threadSlug}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? "Could not delete thread."); }
      router.push(categorySlug ? `/forums/${categorySlug}` : "/forums");
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not delete thread.");
      setDeleting(false);
    }
  }

  const fetchPage = useCallback(async (cursor?: string) => {
    const q = cursor ? `?cursor=${cursor}` : "";
    const res = await fetch(`/api/forums/threads/${threadSlug}/posts${q}`, { cache: "no-store" });
    return (await res.json()) as Paginated<ForumPostDTO>;
  }, [threadSlug]);

  const reload = useCallback(async () => {
    let all: ForumPostDTO[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < PAGE_CAP; i++) {
      const page = await fetchPage(cursor);
      all = all.concat(page.items);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    setPosts(all);
    setLoading(false);
  }, [fetchPage]);

  useEffect(() => { setLoading(true); reload(); }, [reload]);

  useForumStream({
    thread: threadSlug,
    onChange: () => {
      setLive(true);
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(reload, 250);
    },
  });

  function startReply(post: ForumPostDTO, quote: boolean) {
    setReplyTarget({
      parentId: post.id,
      quotePostId: quote ? post.id : null,
      authorName: post.authorName,
      mention: post.authorUsername,
    });
    setTimeout(() => composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }

  // Build the reply tree (parentId → children), ordered by creation.
  const byParent = new Map<string | null, ForumPostDTO[]>();
  for (const p of posts) {
    const key = p.parentId && posts.some((x) => x.id === p.parentId) ? p.parentId : null;
    (byParent.get(key) ?? byParent.set(key, []).get(key)!).push(p);
  }
  const roots = byParent.get(null) ?? [];

  function renderNode(post: ForumPostDTO, depth: number, isOp: boolean): React.ReactNode {
    const children = byParent.get(post.id) ?? [];
    const identity = identities?.[post.authorId];
    // Challengeable = they called the OTHER corner, they aren't you, and you've
    // made a call of your own to put on the line.
    const challengeable =
      !!onChallenge && !!myCorner && !!identity?.corner &&
      identity.corner !== myCorner && post.authorId !== user?.id;
    return (
      <div key={post.id} className={cn(depth > 0 && "mt-3 border-l-2 border-ink-800 pl-3 sm:pl-4")}>
        <PostItem
          post={post}
          isOp={isOp}
          canManage={!!user && user.id === post.authorId}
          requireAuth={!user}
          locked={locked}
          compact={compact}
          identity={identity}
          onChallenge={challengeable ? () => onChallenge!(post.authorId, post.authorName) : undefined}
          onReply={() => startReply(post, false)}
          onQuote={() => startReply(post, true)}
          onChanged={reload}
        />
        {children.length > 0 && (
          <div className={cn(depth + 1 >= MAX_DEPTH ? "" : "")}>
            {children.map((c) => renderNode(c, Math.min(depth + 1, MAX_DEPTH), false))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className={cn("flex items-center justify-between gap-3", compact ? "mb-2" : "mb-3")}>
        {canDeleteThread ? (
          <button
            onClick={deleteThread}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs font-semibold text-fog transition-colors hover:border-blood-500/40 hover:text-blood-400 disabled:opacity-50"
          >
            {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            {t("Delete thread")}
          </button>
        ) : <span />}
        <span className={cn("flex items-center gap-1.5 text-[0.65rem] uppercase tracking-wider", live ? "text-up" : "text-fog")}>
          <Wifi className="size-3" /> {live ? t("Live") : t("Connecting…")}
        </span>
      </div>

      {loading ? (
        <div className={compact ? "space-y-2" : "space-y-3"}>
          {[0, 1, 2].map((i) => <div key={i} className={cn("animate-pulse rounded-card bg-ink-850/60", compact ? "h-20" : "h-28")} />)}
        </div>
      ) : posts.length === 0 ? (
        <div className={cn("card-surface text-center text-sm text-fog", compact ? "p-5" : "p-8")}>
          {emptyLabel ?? t("No posts yet.")}
        </div>
      ) : (
        <div className={compact ? "space-y-2" : "space-y-3"}>
          {roots.map((p, i) => renderNode(p, 0, i === 0 && !p.parentId))}
        </div>
      )}

      <div ref={composerRef} className={cn("scroll-mt-24", compact ? "mt-3" : "mt-6")}>
        {locked ? (
          <p className="card-surface p-4 text-center text-sm text-fog">{t("This thread is locked.")}</p>
        ) : user ? (
          <ReplyComposer
            threadSlug={threadSlug}
            target={replyTarget}
            compact={compact}
            placeholder={placeholder}
            onClearTarget={() => setReplyTarget(null)}
            onPosted={reload}
          />
        ) : (
          <div className="card-surface flex flex-col items-center gap-2 p-5 text-center">
            <p className="text-sm text-mist">{t("Join the conversation.")}</p>
            <Link href="/account" className="rounded-lg bg-blood-500 px-4 py-2 font-display text-xs font-semibold uppercase text-white hover:bg-blood-400">{t("Sign in to reply")}</Link>
          </div>
        )}
      </div>
    </div>
  );
}

function PostItem({
  post, isOp, canManage, requireAuth, locked, compact, identity, onChallenge, onReply, onQuote, onChanged,
}: {
  post: ForumPostDTO; isOp: boolean; canManage: boolean; requireAuth: boolean; locked: boolean;
  compact?: boolean; identity?: RoomIdentity; onChallenge?: () => void;
  onReply: () => void; onQuote: () => void; onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.content);
  const [busy, setBusy] = useState(false);

  async function saveEdit() {
    setBusy(true);
    const res = await fetch(`/api/forums/posts/${post.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: draft }),
    });
    setBusy(false);
    if (res.ok) { setEditing(false); onChanged(); }
  }

  async function remove() {
    if (!confirm("Delete this post?")) return;
    setBusy(true);
    await fetch(`/api/forums/posts/${post.id}`, { method: "DELETE" });
    setBusy(false);
    onChanged();
  }

  // In a room, the subline IS the argument: what they called, then their standing
  // against you. Outside a room it stays the familiar rep + timestamp line.
  const subline = identity ? (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <PickLine identity={identity} />
      <RecordLine identity={identity} />
      <span className="text-fog">{timeAgo(post.createdAt)}{post.edited ? " · edited" : ""}</span>
    </span>
  ) : (
    `${post.authorReputation} rep · ${timeAgo(post.createdAt)}${post.edited ? " · edited" : ""}`
  );

  return (
    <div className={cn("card-surface", compact ? "p-3 sm:p-4" : "p-4 sm:p-5", isOp && "border-blood-500/30")}>
      <div className={cn("flex items-start justify-between gap-2", compact ? "mb-2" : "mb-3")}>
        <AuthorIdentity
          name={post.authorName}
          image={post.authorImage}
          role={post.authorRole}
          appRole={post.authorAppRole}
          sport={post.authorSport}
          username={post.authorUsername}
          size={compact ? "sm" : "md"}
          op={isOp}
          subline={subline}
        />
        {canManage && !post.deleted && !editing && (
          <div className="flex shrink-0 gap-1">
            <button onClick={() => { setDraft(post.content); setEditing(true); }} className="rounded p-1.5 text-fog hover:text-chalk" aria-label="Edit"><Pencil className="size-3.5" /></button>
            <button onClick={remove} disabled={busy} className="rounded p-1.5 text-fog hover:text-blood-400" aria-label="Delete"><Trash2 className="size-3.5" /></button>
          </div>
        )}
      </div>

      {post.quote && (
        <blockquote className="mb-2 rounded-lg border-l-2 border-blood-500/50 bg-ink-950/40 px-3 py-2 text-xs text-fog">
          <span className="font-semibold text-mist">{post.quote.author}</span>
          <span className="mt-0.5 block italic">“{post.quote.excerpt}”</span>
        </blockquote>
      )}

      {post.deleted ? (
        <p className="text-sm italic text-fog">[deleted]</p>
      ) : editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full resize-y rounded-lg border border-ink-700 bg-ink-950/50 p-3 text-sm text-chalk outline-none focus:border-blood-500/50"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}><X className="size-3.5" /> Cancel</Button>
            <Button size="sm" onClick={saveEdit} disabled={busy || !draft.trim()}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save</Button>
          </div>
        </div>
      ) : (
        <>
          {post.content && <RichText text={post.content} className="whitespace-pre-wrap break-words text-sm leading-relaxed text-mist" />}
          {post.attachments.length > 0 && <AttachmentGrid attachments={post.attachments as ForumAttachment[]} />}
        </>
      )}

      {!post.deleted && !editing && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <ReactionBar postId={post.id} initialCounts={post.reactions} initialMine={post.myReactions} requireAuth={requireAuth} />
          <div className="flex items-center gap-1">
            {onChallenge && !locked && (
              <button
                onClick={onChallenge}
                className="inline-flex items-center gap-1 rounded-lg border border-blood-500/40 bg-blood-500/10 px-2 py-1.5 text-xs font-semibold text-blood-300 transition-colors hover:bg-blood-500/20"
                title={`Battle ${post.authorName} on this bout`}
              >
                <Swords className="size-3.5" /> Challenge
              </button>
            )}
            {!locked && (
              <>
                <button onClick={onReply} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-fog transition-colors hover:text-blood-300" title="Reply">
                  <Reply className="size-3.5" /> <span className="hidden sm:inline">Reply</span>
                </button>
                <button onClick={onQuote} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-fog transition-colors hover:text-blood-300" title="Quote reply">
                  <Quote className="size-3.5" /> <span className="hidden sm:inline">Quote</span>
                </button>
              </>
            )}
            <ReportButton targetType="post" targetId={post.id} compact />
          </div>
        </div>
      )}
    </div>
  );
}

function ReplyComposer({
  threadSlug, target, onClearTarget, onPosted, compact, placeholder,
}: {
  threadSlug: string; target: ReplyTarget | null; onClearTarget: () => void; onPosted: () => void;
  compact?: boolean; placeholder?: string;
}) {
  const t = useT();
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<ForumAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill an @mention when replying to a member with a username.
  useEffect(() => {
    if (target?.mention) setContent((c) => (c ? c : `@${target.mention} `));
  }, [target]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/forums/threads/${threadSlug}/posts`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content, attachments,
          parentId: target?.parentId ?? null,
          quotePostId: target?.quotePostId ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not post reply.");
      setContent("");
      setAttachments([]);
      onClearTarget();
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={cn("card-surface", compact ? "p-3 sm:p-4" : "p-4 sm:p-5")}>
      {target && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-blood-500/30 bg-blood-500/5 px-3 py-2 text-xs text-mist">
          <span className="flex items-center gap-1.5">
            {target.quotePostId ? <Quote className="size-3.5 text-blood-300" /> : <CornerDownRight className="size-3.5 text-blood-300" />}
            {target.quotePostId ? "Quoting" : "Replying to"} <span className="font-semibold text-chalk">{target.authorName}</span>
          </span>
          <button type="button" onClick={onClearTarget} className="text-fog hover:text-chalk"><X className="size-3.5" /></button>
        </div>
      )}
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-blood-500/40 bg-blood-500/10 p-2.5 text-sm text-blood-200">
          <AlertCircle className="mt-0.5 size-4 shrink-0" /> <span>{error}</span>
        </div>
      )}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={placeholder ?? t("Add your take… use @ to mention someone")}
        rows={compact ? 2 : 3}
        className="w-full resize-y rounded-lg border border-ink-700 bg-ink-950/50 p-3 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50"
      />
      <div className="mt-3">
        <MediaComposer attachments={attachments} onChange={setAttachments} />
      </div>
      <div className="mt-3 flex justify-end">
        <Button type="submit" size="sm" disabled={busy || (!content.trim() && attachments.length === 0)}>
          {busy ? <><Loader2 className="size-4 animate-spin" /> {t("Posting…")}</> : t("Post reply")}
        </Button>
      </div>
    </form>
  );
}
