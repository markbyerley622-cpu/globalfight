import { Heart, MessageSquare, ShieldCheck } from "lucide-react";
import type { DiscussionPost as Post } from "@/lib/domain/types";
import { timeAgo } from "@/lib/domain/format";
import { Badge } from "@/components/ui/Badge";

/**
 * A single discussion post. Reply composer is a skeleton affordance. Reputation
 * over a threshold earns a "respected" marker (drives most-respected sorting).
 */
export function DiscussionPost({ post, boutTag }: { post: Post; boutTag?: string }) {
  const respected = post.author.reputation >= 1500;
  return (
    <article className="rounded-xl border border-border bg-surface p-3.5">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-surface-2 text-[11px] font-semibold text-muted">
          {post.author.handle.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">@{post.author.handle}</span>
            {respected ? (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-success" title="Respected member">
                <ShieldCheck className="h-3 w-3" />
              </span>
            ) : null}
          </div>
          <span className="text-[11px] text-faint">
            {post.author.reputation.toLocaleString()} rep · {timeAgo(post.createdAt)}
          </span>
        </div>
        {boutTag ? <Badge tone="outline">{boutTag}</Badge> : null}
        {post.phase === "live" ? <Badge tone="live">Live</Badge> : null}
      </div>

      <p className="mt-2 text-sm leading-relaxed text-fg">{post.body}</p>

      <div className="mt-2.5 flex items-center gap-4 text-[11px] text-faint">
        <span className="inline-flex items-center gap-1">
          <Heart className="h-3.5 w-3.5" /> {post.reactionCount}
        </span>
        <button type="button" className="inline-flex items-center gap-1 hover:text-fg">
          <MessageSquare className="h-3.5 w-3.5" /> {post.replyCount} replies
        </button>
      </div>
    </article>
  );
}
