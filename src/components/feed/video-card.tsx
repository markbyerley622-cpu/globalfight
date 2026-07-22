"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Play } from "lucide-react";
import { embedUrl, thumbnailUrl } from "@/lib/feed/channels";
import { cleanTitle } from "./client";
import { timeAgo, cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  ONE video card, used by the Following feed and the /clips grid.
//
//  EXACTLY ONE PLAYER, EVER. The active video id lives in a context above the
//  list, so opening a second card closes the first by construction — there is
//  no "close the other one" bookkeeping to get wrong, because only the card
//  whose id matches renders an <iframe> at all. Everything else is a thumbnail.
//
//  NOTHING AUTOPLAYS on render. A feed that starts playing at you is a feed
//  people scroll past with the sound off, and twenty mounted iframes is twenty
//  third-party documents — which would undo the whole point of the nocookie
//  host. The iframe is created by a click and destroyed when another is opened.
// ════════════════════════════════════════════════════════════════════════════

const ActiveVideo = createContext<{
  activeId: string | null;
  setActiveId: (id: string | null) => void;
}>({ activeId: null, setActiveId: () => {} });

export function VideoCardProvider({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  return <ActiveVideo.Provider value={{ activeId, setActiveId }}>{children}</ActiveVideo.Provider>;
}

export interface VideoCardData {
  id: string;
  title: string;
  channel: string;
  publishedAt?: string | null;
  /** Promotion slug, for the badge. */
  promotion?: string | null;
  promotionName?: string | null;
  /** "Because you follow UFC" — always present in the feed, absent on /clips
   *  where the filter chips already say why. */
  reason?: string | null;
}

export function VideoCard({ video, className }: { video: VideoCardData; className?: string }) {
  const { activeId, setActiveId } = useContext(ActiveVideo);
  const playing = activeId === video.id;
  const src = playing ? embedUrl(video.id) : null;
  const thumb = thumbnailUrl(video.id);

  return (
    <div className={cn("overflow-hidden rounded-xl border border-ink-700 bg-ink-900/60", className)}>
      {playing && src ? (
        <div className="aspect-video bg-black">
          <iframe
            // autoplay ONLY here: the user just clicked play on this exact card.
            src={`${src}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
            title={cleanTitle(video.title)}
            className="size-full"
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setActiveId(video.id)}
          className="group block w-full"
          aria-label={`Play ${cleanTitle(video.title)}`}
        >
          <span className="relative block aspect-video bg-ink-900">
            {thumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumb}
                alt=""
                loading="lazy"
                decoding="async"
                className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
            )}
            <span className="absolute inset-0 grid place-items-center bg-ink-950/25 transition-colors group-hover:bg-ink-950/40">
              <span className="grid size-12 place-items-center rounded-full bg-blood-500/90 text-white shadow-lg">
                <Play className="size-5" fill="currentColor" />
              </span>
            </span>
            {video.promotionName && (
              <span className="absolute left-2 top-2 rounded-md bg-ink-950/80 px-1.5 py-0.5 font-display text-[0.6rem] font-bold uppercase tracking-wide text-chalk backdrop-blur">
                {video.promotionName}
              </span>
            )}
          </span>
        </button>
      )}

      <div className="p-3">
        {video.reason && (
          <p className="mb-1 font-display text-[0.62rem] font-bold uppercase tracking-widest text-blood-400">
            {video.reason}
          </p>
        )}
        <p className="line-clamp-2 font-display text-sm font-bold leading-snug text-chalk">
          {cleanTitle(video.title)}
        </p>
        <p className="mt-0.5 text-[0.7rem] text-fog">
          {video.channel}
          {video.publishedAt ? ` · ${timeAgo(new Date(video.publishedAt))}` : ""}
        </p>
      </div>
    </div>
  );
}
