"use client";

import { useState } from "react";
import { Bookmark, Bell, BellRing, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-client";
import { ShareMenu, CopyLinkButton } from "@/components/share-menu";
import { ReportButton } from "@/components/forums/report-dialog";
import type { ForumThreadDTO } from "@/lib/forum/types";

/**
 * Thread engagement toolbar (Phase 6/7): Bookmark/Save, Follow/Subscribe, Share,
 * Copy Link, Report. Optimistic toggles backed by /bookmark and /follow.
 */
export function ThreadEngagement({ thread }: { thread: ForumThreadDTO }) {
  const { user } = useAuth();
  const [bookmarked, setBookmarked] = useState(!!thread.bookmarked);
  const [following, setFollowing] = useState(!!thread.following);
  const shareCount = thread.shareCount;
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(kind: "bookmark" | "follow") {
    if (!user) { window.location.href = "/account"; return; }
    if (busy) return;
    setBusy(kind);
    const optimistic = kind === "bookmark" ? !bookmarked : !following;
    kind === "bookmark" ? setBookmarked(optimistic) : setFollowing(optimistic);
    try {
      const res = await fetch(`/api/forums/threads/${thread.slug}/${kind}`, { method: "POST" });
      if (res.ok) {
        const d = await res.json();
        if (kind === "bookmark") setBookmarked(!!d.bookmarked);
        else setFollowing(!!d.following);
      } else {
        kind === "bookmark" ? setBookmarked(!optimistic) : setFollowing(!optimistic);
      }
    } catch {
      kind === "bookmark" ? setBookmarked(!optimistic) : setFollowing(!optimistic);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => toggle("bookmark")}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors",
          bookmarked ? "border-gold-500/50 bg-gold-500/10 text-gold-300" : "border-ink-700 text-fog hover:border-blood-500/40 hover:text-blood-300",
        )}
      >
        {busy === "bookmark" ? <Loader2 className="size-3.5 animate-spin" /> : <Bookmark className={cn("size-3.5", bookmarked && "fill-current")} />}
        {bookmarked ? "Saved" : "Save"}
      </button>

      <button
        onClick={() => toggle("follow")}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors",
          following ? "border-blood-500/50 bg-blood-500/15 text-blood-200" : "border-ink-700 text-fog hover:border-blood-500/40 hover:text-blood-300",
        )}
      >
        {busy === "follow" ? <Loader2 className="size-3.5 animate-spin" /> : following ? <BellRing className="size-3.5" /> : <Bell className="size-3.5" />}
        {following ? "Following" : "Follow"}
      </button>

      <ShareMenu
        path={`/forums/${thread.categorySlug}/${thread.slug}`}
        title={thread.title}
        // The forum's own signal: shares feed the trending score.
        onShared={() => { fetch(`/api/forums/threads/${thread.slug}/share`, { method: "POST" }).catch(() => {}); }}
      />
      {shareCount > 0 && <span className="text-xs text-fog">{shareCount} share{shareCount === 1 ? "" : "s"}</span>}

      <CopyLinkButton path={`/forums/${thread.categorySlug}/${thread.slug}`} />
      <ReportButton targetType="thread" targetId={thread.id} />
    </div>
  );
}
