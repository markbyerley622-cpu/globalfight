"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageSquareOff } from "lucide-react";
import type { GymPostDTO, Page } from "@/lib/gym-posts/types";
import { GymPostCard } from "./gym-post-card";
import { GymComposer } from "./gym-composer";
import { FeedSkeleton, PostSkeleton } from "./skeletons";
import { feedKey, loadFeed, saveFeed, dropFeed } from "./feed-cache";

// ════════════════════════════════════════════════════════════════════════════
//  THE FEED.
//
//  ── No waterfall on first paint ──────────────────────────────────────────
//  Page one is rendered on the SERVER and handed in as `initialPage`. The
//  client does not fetch to show its first screen — it hydrates what is already
//  there and only goes to the network when the reader scrolls. The alternative
//  (mount → spinner → fetch → paint) puts a round-trip in front of content the
//  server already had in hand.
//
//  ── Prefetch, not "load more" ────────────────────────────────────────────
//  The sentinel sits 800px BELOW the last card, so the next page is requested
//  while the reader is still reading the current one. By the time they reach
//  the end it is usually already there, and the feed simply never stops. A
//  sentinel at the exact bottom guarantees a visible pause every single page.
//
//  ── Virtualisation: what was chosen, and why not windowing ───────────────
//  Cards have wildly variable heights (text, one photo, ten photos, an open
//  comment thread), so a windowing library needs height estimates it will get
//  wrong, and — more seriously — it REMOVES off-screen cards from the DOM. The
//  app's scroll restoration works by letting the container grow back to its old
//  height; a windowed list never does, so Back would land in the wrong place on
//  every long feed.
//
//  So the DOM stays, and the rendering work is skipped instead:
//  `content-visibility: auto` with an intrinsic size hint lets the browser skip
//  layout, style and paint for off-screen cards while keeping them present and
//  measurable. Native, no dependency, no height guesses, and Back still works.
//  See `.feed-card` in globals.css.
// ════════════════════════════════════════════════════════════════════════════

interface Props {
  initialPage: Page<GymPostDTO>;
  /** Scope to one gym, or null for the cross-gym feed. */
  gymSlug: string | null;
  gymName?: string;
  signedIn: boolean;
  /** Whether the viewer may publish here. Decided by the SERVER. */
  canPost: boolean;
}

export function GymFeed({ initialPage, gymSlug, gymName, signedIn, canPost }: Props) {
  const key = feedKey(gymSlug);
  const [items, setItems] = useState<GymPostDTO[]>(initialPage.items);
  const [cursor, setCursor] = useState<string | null>(initialPage.nextCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const sentinel = useRef<HTMLDivElement>(null);
  // Guards the observer against firing twice for the same cursor while a
  // request is in flight — an IntersectionObserver can fire repeatedly as the
  // sentinel is scrolled past.
  const inflight = useRef<string | null>(null);

  // ── Restore the pages a Back navigation would otherwise discard ─────────
  // The app's ScrollRestoration re-applies scrollTop while the container is
  // still growing, but it has nothing to grow back to if the feed remounts
  // holding only page one. Restoring the DATA is what gives it a container tall
  // enough to scroll. See feed-cache.ts.
  useEffect(() => {
    const cached = loadFeed(key);
    if (cached && cached.items.length > initialPage.items.length) {
      setItems(cached.items);
      setCursor(cached.cursor);
    }
    setRestoring(false);
  }, [key, initialPage.items.length]);

  useEffect(() => {
    if (restoring) return;
    saveFeed(key, items, cursor);
  }, [key, items, cursor, restoring]);

  const loadMore = useCallback(async () => {
    if (!cursor || inflight.current === cursor) return;
    inflight.current = cursor;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ cursor });
      if (gymSlug) params.set("gym", gymSlug);
      const res = await fetch(`/api/gym/posts?${params}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as Page<GymPostDTO>;
      setItems((prev) => {
        // The cursor guarantees these are strictly older than what is on screen,
        // but a post published in another tab between two pages could still
        // arrive twice. Cheap to guard, and a duplicate React key is a crash.
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...data.items.filter((p) => !seen.has(p.id))];
      });
      setCursor(data.nextCursor);
    } catch {
      setError("Couldn't load more posts.");
      // Cleared so the retry button can re-arm this cursor.
      inflight.current = null;
    } finally {
      setBusy(false);
    }
  }, [cursor, gymSlug]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !cursor) return;

    // The app's real scroller is `#main`, not the document (AppShell is a 100dvh
    // frame with overflow-hidden). An observer left on the default root watches
    // the viewport and never fires here.
    const root = document.getElementById("main");
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) void loadMore(); },
      { root, rootMargin: "800px 0px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

  const replace = useCallback((post: GymPostDTO) => {
    setItems((prev) => prev.map((p) => (p.id === post.id ? post : p)));
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const published = useCallback(
    (post: GymPostDTO) => {
      setItems((prev) => [post, ...prev]);
      // The cached copy is now behind. Dropping it is cheaper and more honest
      // than patching it — the next render writes a fresh one anyway.
      dropFeed(key);
    },
    [key],
  );

  return (
    <div className="flex flex-col gap-3">
      {canPost && gymSlug && (
        <GymComposer gymSlug={gymSlug} gymName={gymName ?? "your gym"} onPublished={published} />
      )}

      {items.length === 0 && !busy && (
        <p className="flex flex-col items-center gap-2 rounded-card border border-dashed border-ink-700 bg-ink-900/40 px-4 py-10 text-center text-sm text-fog">
          <MessageSquareOff className="size-5" aria-hidden />
          {canPost
            ? "Nothing here yet. Post the first thing."
            : gymSlug
              ? "This gym hasn't posted yet."
              : "Nothing in your feed yet — join a gym to see its posts."}
        </p>
      )}

      {items.map((post, i) => (
        <div key={post.id} className="feed-card">
          <GymPostCard
            post={post}
            signedIn={signedIn}
            hideGym={!!gymSlug}
            // Only the very first image on the page is eager. Everything else
            // is lazy — a feed that eager-loads is a feed that opens twenty
            // connections before the reader has scrolled once.
            priority={i === 0}
            onChange={replace}
            onDelete={remove}
          />
        </div>
      ))}

      {/* Busy state is a SKELETON, not a spinner: it occupies the height the
          incoming card will occupy, so nothing on screen moves when it lands. */}
      {busy && <PostSkeleton />}
      {restoring && items.length === 0 && <FeedSkeleton />}

      {error && (
        <div role="alert" className="flex flex-col items-center gap-2 py-3 text-center">
          <p className="text-xs text-blood-300">{error}</p>
          <button
            type="button"
            onClick={() => void loadMore()}
            className="tap flex min-h-11 items-center gap-2 rounded-lg border border-ink-700 px-4 text-xs font-semibold text-mist transition-colors hover:border-blood-500/40 hover:text-blood-300"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Try again
          </button>
        </div>
      )}

      {/* The prefetch trigger. Zero height — it exists to be observed. */}
      {cursor && <div ref={sentinel} aria-hidden className="h-px w-full" />}

      {!cursor && items.length > 0 && (
        <p className="py-4 text-center text-2xs text-fog">That&apos;s everything.</p>
      )}
    </div>
  );
}
