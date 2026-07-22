"use client";

import { useState } from "react";
import { Play, X } from "lucide-react";
import { embedUrl, thumbnailUrl, watchUrl } from "@/lib/feed/channels";
import { cleanTitle } from "./client";
import { timeAgo } from "@/lib/utils";
import type { FeedVideo } from "@/lib/feed/types";

// ════════════════════════════════════════════════════════════════════════════
//  The browse grid. Thumbnails until you ask to watch.
//
//  Nothing loads a player until it is clicked: twenty auto-embedded iframes is
//  twenty third-party documents, and the point of the nocookie host is undone
//  if the page mounts them all on arrival anyway. The thumbnail is a plain
//  <img> from i.ytimg.com — next/image is not used because remotePatterns
//  deliberately allows own-storage hosts only.
//
//  Both URLs come from lib/feed/channels, which validates the id and is the
//  only place the embed host is written down.
// ════════════════════════════════════════════════════════════════════════════

export function VideoGrid({ videos }: { videos: FeedVideo[] }) {
  const [playing, setPlaying] = useState<FeedVideo | null>(null);
  const src = playing ? embedUrl(playing.id) : null;

  return (
    <>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {videos.map((v) => {
          const thumb = thumbnailUrl(v.id);
          return (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => setPlaying(v)}
                className="group w-full text-left"
                aria-label={`Play ${cleanTitle(v.title)}`}
              >
                <span className="relative block aspect-video overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
                  {thumb && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumb}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  )}
                  <span className="absolute inset-0 grid place-items-center bg-ink-950/30 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="grid size-12 place-items-center rounded-full bg-blood-500/90 text-white">
                      <Play className="size-5" />
                    </span>
                  </span>
                </span>
                <span className="mt-2 block line-clamp-2 font-display text-sm font-bold leading-snug text-chalk group-hover:text-blood-300">
                  {cleanTitle(v.title)}
                </span>
                <span className="mt-0.5 block text-[0.72rem] text-fog">
                  {v.channel}
                  {v.publishedAt ? ` · ${timeAgo(new Date(v.publishedAt))}` : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {playing && src && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={cleanTitle(playing.title)}
          className="fixed inset-0 z-50 grid place-items-center bg-ink-950/90 p-4"
          onClick={() => setPlaying(null)}
        >
          <div className="w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-start gap-3">
              <p className="min-w-0 flex-1 font-display text-sm font-bold text-chalk">{cleanTitle(playing.title)}</p>
              <button
                type="button"
                onClick={() => setPlaying(null)}
                className="tap shrink-0 rounded-lg border border-ink-600 p-1.5 text-fog hover:text-chalk"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="aspect-video overflow-hidden rounded-xl border border-ink-700 bg-black">
              <iframe
                src={`${src}?autoplay=1&rel=0&modestbranding=1`}
                title={cleanTitle(playing.title)}
                className="size-full"
                allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
            <a
              href={watchUrl(playing.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-[0.72rem] text-fog underline decoration-fog/40 underline-offset-2 hover:text-chalk"
            >
              Watch on YouTube
            </a>
          </div>
        </div>
      )}
    </>
  );
}
