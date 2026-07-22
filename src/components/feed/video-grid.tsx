"use client";

import { VideoCard, VideoCardProvider } from "./video-card";
import type { FeedVideo } from "@/lib/feed/types";

// The /clips grid. It owns layout and nothing else — the card, the one-player
// rule and the no-autoplay rule all live in VideoCard, shared with the
// Following feed. Two implementations of "play a video" is how one of them
// quietly starts autoplaying.
export function VideoGrid({ videos }: { videos: FeedVideo[] }) {
  return (
    <VideoCardProvider>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {videos.map((v) => (
          <li key={v.id}>
            <VideoCard
              video={{
                id: v.id,
                title: v.title,
                channel: v.channel,
                publishedAt: v.publishedAt,
                promotion: v.promotion,
                // No reason line here: the filter chips above the grid already
                // say why these are the videos on screen.
              }}
            />
          </li>
        ))}
      </ul>
    </VideoCardProvider>
  );
}
