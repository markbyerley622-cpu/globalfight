import { ImageIcon } from "lucide-react";
import type { Article, ArticleType } from "@/lib/domain/types";
import { timeAgo } from "@/lib/domain/format";
import { Badge } from "@/components/ui/Badge";

const TYPE_LABELS: Record<ArticleType, string> = {
  preview: "Preview",
  "fight-breakdown": "Breakdown",
  "press-conference": "Presser",
  "weigh-in": "Weigh-in",
  interview: "Interview",
  "injury-update": "Injury",
  announcement: "News",
  broadcast: "Broadcast",
  "post-event-report": "Report",
};

/**
 * A single piece of event-attached coverage. `boutTag` marks articles scoped to
 * a specific fight.
 */
export function CoverageCard({ article, boutTag }: { article: Article; boutTag?: string }) {
  return (
    <article className="flex gap-3 rounded-xl border border-border bg-surface p-3">
      <div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-surface-2 text-faint">
        {/* Placeholder — no imagery ships in the skeleton. */}
        <ImageIcon className="h-5 w-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="brand">{TYPE_LABELS[article.type]}</Badge>
          {boutTag ? <Badge tone="outline">{boutTag}</Badge> : null}
        </div>
        <h4 className="mt-1 line-clamp-2 text-sm font-semibold leading-snug">{article.title}</h4>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted">{article.excerpt}</p>
        <p className="mt-1 text-[11px] text-faint">
          {article.author} · {article.source} · {timeAgo(article.publishedAt)}
        </p>
      </div>
    </article>
  );
}
