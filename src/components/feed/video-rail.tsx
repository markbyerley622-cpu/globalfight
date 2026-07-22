import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { VideoCard, VideoCardProvider } from "./video-card";
import type { VideoRec } from "@/lib/feed/recommend";

// The shared contextual rail: fighter pages, event pages, articles and
// promotion surfaces all render THIS rather than each laying out their own
// grid. It is a server component wrapping the client card, so a page pays for
// no extra JavaScript beyond the player that already exists.
//
// Renders nothing at all when there is nothing to say — an empty "Watch"
// heading is worse than no heading.
export function VideoRail({
  videos,
  title = "Watch",
  moreHref,
}: {
  videos: VideoRec[];
  title?: string;
  moreHref?: string;
}) {
  if (!videos.length) return null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-bold uppercase tracking-wide text-chalk">{title}</h2>
        {moreHref && (
          <Link
            href={moreHref}
            className="inline-flex items-center gap-1 text-[0.72rem] font-semibold text-fog transition-colors hover:text-blood-300"
          >
            More <ArrowRight className="size-3.5" />
          </Link>
        )}
      </div>
      <VideoCardProvider>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {videos.map((v) => (
            <li key={v.id}>
              <VideoCard
                video={{
                  id: v.id,
                  title: v.title,
                  channel: v.channel,
                  publishedAt: v.publishedAt,
                  promotion: v.promotion,
                  promotionName: v.promotionName,
                  reason: v.reason,
                }}
              />
            </li>
          ))}
        </ul>
      </VideoCardProvider>
    </section>
  );
}
