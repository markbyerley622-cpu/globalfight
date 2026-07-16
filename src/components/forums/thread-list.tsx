"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MessageSquare, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-client";
import { useT } from "@/lib/i18n";
import { useForumStream } from "@/lib/forum/use-forum-stream";
import { NewThreadComposer } from "@/components/forums/new-thread";
import { ThreadCard } from "@/components/forums/thread-card";
import type { ForumCategoryDTO, ForumThreadDTO, Paginated } from "@/lib/forum/types";

export function ThreadList({
  categorySlug, categories,
}: {
  categorySlug?: string;
  categories: ForumCategoryDTO[];
}) {
  const { user } = useAuth();
  const t = useT();
  const [threads, setThreads] = useState<ForumThreadDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());

  async function deleteThread(thread: ForumThreadDTO) {
    if (!confirm(`Delete your thread "${thread.title}"? This can't be undone.`)) return;
    setDeletingId(thread.id);
    try {
      const res = await fetch(`/api/forums/threads/${thread.slug}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? "Could not delete thread."); }
      seen.current.delete(thread.id);
      setThreads((prev) => prev.filter((x) => x.id !== thread.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not delete thread.");
    } finally {
      setDeletingId(null);
    }
  }

  const baseQuery = categorySlug ? `category=${encodeURIComponent(categorySlug)}` : "";

  const fetchPage = useCallback(async (afterCursor?: string) => {
    const q = [baseQuery, afterCursor ? `cursor=${afterCursor}` : ""].filter(Boolean).join("&");
    const res = await fetch(`/api/forums/threads?${q}`, { cache: "no-store" });
    return (await res.json()) as Paginated<ForumThreadDTO>;
  }, [baseQuery]);

  const loadFirst = useCallback(async () => {
    const page = await fetchPage();
    seen.current = new Set(page.items.map((t) => t.id));
    setThreads(page.items);
    setCursor(page.nextCursor);
    setLoading(false);
  }, [fetchPage]);

  useEffect(() => { setLoading(true); loadFirst(); }, [loadFirst]);

  useForumStream({
    category: categorySlug,
    onChange: async (e) => {
      if (e?.type === "thread:delete") {
        setThreads((prev) => prev.filter((x) => x.slug !== e.threadSlug));
        return;
      }
      const page = await fetchPage();
      const fresh = page.items.filter((t) => !seen.current.has(t.id));
      if (fresh.length) {
        fresh.forEach((t) => seen.current.add(t.id));
        setThreads((prev) => [...fresh, ...prev]);
      }
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
    if (!seen.current.has(thread.id)) {
      seen.current.add(thread.id);
      setThreads((prev) => [thread, ...prev]);
    }
    setComposerOpen(false);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-fog">{loading ? "Loading…" : `${threads.length}${cursor ? "+" : ""} thread${threads.length === 1 ? "" : "s"}`}</p>
        {user ? (
          <Button size="sm" onClick={() => setComposerOpen((v) => !v)}>
            <Plus className="size-4" /> {t("New thread")}
          </Button>
        ) : (
          <Link href="/account" className="text-xs font-semibold text-blood-400 hover:text-blood-300">{t("Sign in to post")}</Link>
        )}
      </div>

      {composerOpen && user && (
        <NewThreadComposer
          fixedCategory={categorySlug}
          categories={categories}
          onCreated={onCreated}
          onCancel={() => setComposerOpen(false)}
        />
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-card bg-ink-850/60" />)}
        </div>
      ) : threads.length === 0 ? (
        <div className="card-surface p-8 text-center">
          <MessageSquare className="mx-auto mb-3 size-8 text-ink-600" />
          <p className="font-display font-semibold text-chalk">{t("No threads yet")}</p>
          <p className="mt-1 text-sm text-fog">{t("Be the first to start the conversation.")}</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {threads.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              showCategory={!categorySlug}
              canDelete={!!user && user.id === thread.authorId}
              deleting={deletingId === thread.id}
              onDelete={() => deleteThread(thread)}
            />
          ))}
        </ul>
      )}

      {cursor && !loading && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? <><Loader2 className="size-4 animate-spin" /> {t("Loading…")}</> : t("Load more")}
          </Button>
        </div>
      )}
    </div>
  );
}
