"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus, Loader2, MessageSquare, Flame, Clock, Bell, TrendingUp, Sparkles, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-client";
import { useForumStream } from "@/lib/forum/use-forum-stream";
import { NewThreadComposer } from "@/components/forums/new-thread";
import { ThreadCard } from "@/components/forums/thread-card";
import { cn } from "@/lib/utils";
import type { ForumCategoryDTO, ForumThreadDTO, Paginated } from "@/lib/forum/types";

type Sort = "latest" | "trending" | "following" | "most-discussed" | "newest" | "most-liked";
type Win = "today" | "week" | "month";

const TABS: { key: Sort; label: string; icon: typeof Clock; auth?: boolean }[] = [
  { key: "trending", label: "Hot", icon: Flame },
  { key: "newest", label: "New", icon: Sparkles },
  { key: "most-liked", label: "Top", icon: Heart },
  { key: "latest", label: "Latest", icon: Clock },
  { key: "most-discussed", label: "Discussed", icon: MessageSquare },
  { key: "following", label: "Following", icon: Bell, auth: true },
];

const WINDOWS: { key: Win; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
];

/**
 * Community feed (Phase 9): Latest / Trending / Following / Most Discussed /
 * Newest / Most Liked, with Today/Week/Month windows for Trending (Phase 8).
 */
export function CommunityFeed({ categories }: { categories: ForumCategoryDTO[] }) {
  const { user } = useAuth();
  const [sort, setSort] = useState<Sort>("latest");
  const [win, setWin] = useState<Win>("week");
  const [threads, setThreads] = useState<ForumThreadDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const seen = useRef<Set<string>>(new Set());

  const query = useCallback((c?: string) => {
    const p = new URLSearchParams({ sort, limit: "20" });
    if (sort === "trending") p.set("window", win);
    if (c) p.set("cursor", c);
    return p.toString();
  }, [sort, win]);

  const fetchPage = useCallback(async (c?: string) => {
    const res = await fetch(`/api/forums/feed?${query(c)}`, { cache: "no-store" });
    return (await res.json()) as Paginated<ForumThreadDTO>;
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    const page = await fetchPage();
    seen.current = new Set(page.items.map((t) => t.id));
    setThreads(page.items);
    setCursor(page.nextCursor);
    setLoading(false);
  }, [fetchPage]);

  useEffect(() => { load(); }, [load]);

  // Realtime: on the activity-ordered tabs, surface genuinely new threads.
  useForumStream({
    onChange: async () => {
      if (sort !== "latest" && sort !== "newest") return;
      const page = await fetchPage();
      const fresh = page.items.filter((t) => !seen.current.has(t.id));
      if (fresh.length) { fresh.forEach((t) => seen.current.add(t.id)); setThreads((prev) => [...fresh, ...prev]); }
    },
  });

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    const page = await fetchPage(cursor);
    page.items.forEach((t) => seen.current.add(t.id));
    setThreads((prev) => [...prev, ...page.items]);
    setCursor(page.nextCursor);
    setLoadingMore(false);
  }

  function onCreated(thread: ForumThreadDTO) {
    if (!seen.current.has(thread.id)) { seen.current.add(thread.id); setThreads((prev) => [thread, ...prev]); }
    setComposerOpen(false);
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-fog">
          <TrendingUp className="size-4 text-blood-400" /> Community Feed
        </h2>
        {user ? (
          <Button size="sm" onClick={() => setComposerOpen((v) => !v)}><Plus className="size-4" /> New thread</Button>
        ) : (
          <Link href="/account" className="text-xs font-semibold text-blood-400 hover:text-blood-300">Sign in to post</Link>
        )}
      </div>

      {composerOpen && user && (
        <NewThreadComposer categories={categories} onCreated={onCreated} onCancel={() => setComposerOpen(false)} />
      )}

      {/* Sort tabs — horizontal scroll on mobile, no overflow. */}
      <div data-hscroll className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.filter((t) => !t.auth || user).map((tab) => {
          const Icon = tab.icon;
          const active = sort === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setSort(tab.key)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                active ? "border-blood-500 bg-blood-500/15 text-blood-200" : "border-ink-700 text-fog hover:border-ink-600 hover:text-mist",
              )}
            >
              <Icon className="size-3.5" /> {tab.label}
            </button>
          );
        })}
      </div>

      {sort === "trending" && (
        <div className="mb-3 flex gap-1.5">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              onClick={() => setWin(w.key)}
              className={cn(
                "rounded-full px-3 py-1 text-[0.7rem] font-semibold transition-colors",
                win === w.key ? "bg-ink-700 text-chalk" : "text-fog hover:text-mist",
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-2.5">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-card bg-ink-850/60" />)}
        </div>
      ) : threads.length === 0 ? (
        <div className="card-surface p-8 text-center">
          <MessageSquare className="mx-auto mb-3 size-8 text-ink-600" />
          <p className="font-display font-semibold text-chalk">
            {sort === "following" ? "You're not following any threads yet." : "Nothing here yet."}
          </p>
          <p className="mt-1 text-sm text-fog">
            {sort === "following" ? "Follow threads to see them here." : "Be the first to start the conversation."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {threads.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              showCategory
              canDelete={!!user && user.id === thread.authorId}
              onDelete={async () => {
                if (!confirm(`Delete "${thread.title}"?`)) return;
                const res = await fetch(`/api/forums/threads/${thread.slug}`, { method: "DELETE" });
                if (res.ok) { seen.current.delete(thread.id); setThreads((p) => p.filter((x) => x.id !== thread.id)); }
              }}
            />
          ))}
        </ul>
      )}

      {cursor && !loading && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? <><Loader2 className="size-4 animate-spin" /> Loading…</> : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
