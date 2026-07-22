"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { X, Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-client";
import { ThreadDiscussion } from "@/components/forums/thread-discussion";
import { suggestedCommunitySlug } from "@/lib/community/topics";
import type { FeedVideo } from "./client";
import { embedUrl } from "@/lib/feed/channels";

interface Discussion {
  slug: string;
  title: string;
  categorySlug: string;
  categoryName: string;
  locked: boolean;
  authorId: string;
  replyCount: number;
}
interface Community { slug: string; name: string }

// In-app discussion for a feed video: the clip pinned on top, the community
// thread (comments/replies/reactions, realtime) below. If no discussion exists
// yet, the viewer picks a community and starts it — the "easy path". A video is
// NOT auto-bound to a community; the starter chooses.
export function DiscussionSheet({ video, onClose }: { video: FeedVideo; onClose: () => void }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [discussion, setDiscussion] = useState<Discussion | null>(null);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [picked, setPicked] = useState<string>(suggestedCommunitySlug(video.topic));
  const [comment, setComment] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/feed/videos/${video.id}/discussion`, { cache: "no-store" });
      const data = (await res.json()) as { discussion: Discussion | null };
      setDiscussion(data.discussion);
    } catch { /* show the start form */ }
    setLoading(false);
  }, [video.id]);

  useEffect(() => { load(); }, [load]);

  // Only need the community list when the viewer is about to start a discussion.
  useEffect(() => {
    if (discussion || loading) return;
    fetch("/api/communities", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { communities: Community[] }) => setCommunities(d.communities ?? []))
      .catch(() => {});
  }, [discussion, loading]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function start() {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/feed/videos/${video.id}/discussion`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          communitySlug: picked,
          comment: comment.trim() || undefined,
          video: {
            title: video.title, channel: video.channel, channelId: video.channelId,
            topic: video.topic, tags: video.tags,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start the discussion.");
      setDiscussion(data.discussion as Discussion);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[140] flex flex-col bg-ink-950">
      {/* header */}
      <div className="flex items-center gap-3 border-b border-ink-800 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <MessageCircle className="size-5 text-blood-400" />
        <span className="font-display text-sm font-semibold uppercase tracking-wide text-chalk">Discussion</span>
        <div className="flex-1" />
        <button onClick={onClose} aria-label="Close discussion" className="flex size-9 items-center justify-center rounded-full border border-ink-700 bg-ink-850 text-chalk">
          <X className="size-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* pinned video */}
        <div className="border-b border-ink-800 bg-black">
          <div className="relative mx-auto aspect-video w-full max-w-2xl">
            <iframe
              className="absolute inset-0 size-full"
              src={embedUrl(video.id) ? `${embedUrl(video.id)}?playsinline=1&rel=0&modestbranding=1` : undefined}
              title={video.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
          <div className="mx-auto max-w-2xl px-4 py-3">
            <p className="line-clamp-2 text-sm font-semibold text-chalk">{video.title}</p>
            {video.channel && <p className="mt-0.5 text-xs text-fog">{video.channel}</p>}
          </div>
        </div>

        {/* thread / start */}
        <div className="mx-auto max-w-2xl px-4 py-5">
          {loading ? (
            <div className="flex justify-center py-10 text-fog"><Loader2 className="size-6 animate-spin" /></div>
          ) : discussion ? (
            <>
              <div className="mb-4">
                <p className="text-xs text-fog">Discussion in</p>
                <Link href={`/community/${discussion.categorySlug}`} className="font-display text-base font-bold text-chalk hover:text-blood-300">
                  {discussion.categoryName}
                </Link>
              </div>
              <ThreadDiscussion
                threadSlug={discussion.slug}
                locked={discussion.locked}
                threadAuthorId={discussion.authorId}
                categorySlug={discussion.categorySlug}
              />
            </>
          ) : !user ? (
            <div className="card-surface flex flex-col items-center gap-3 p-6 text-center">
              <p className="text-sm text-mist">Be the first to discuss this clip.</p>
              <Link href="/account" className="rounded-lg bg-blood-500 px-4 py-2 font-display text-xs font-semibold uppercase text-white hover:bg-blood-400">
                Sign in to start
              </Link>
            </div>
          ) : (
            <div className="card-surface p-5">
              <h3 className="font-display text-base font-bold text-chalk">Start the discussion</h3>
              <p className="mt-1 text-xs text-fog">Choose a community for this clip and add your take.</p>

              <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-mist">Community</label>
              <select
                value={picked}
                onChange={(e) => setPicked(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-ink-700 bg-ink-950/60 p-2.5 text-sm text-chalk outline-none focus:border-blood-500/50"
              >
                {communities.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>

              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add the first comment… (optional)"
                rows={3}
                className="mt-3 w-full resize-y rounded-lg border border-ink-700 bg-ink-950/60 p-3 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50"
              />

              {error && <p className="mt-2 text-sm text-blood-300">{error}</p>}

              <div className="mt-4 flex justify-end">
                <Button size="sm" onClick={start} disabled={starting || !picked}>
                  {starting ? <><Loader2 className="size-4 animate-spin" /> Starting…</> : "Start discussion"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
