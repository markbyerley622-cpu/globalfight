"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClipReels, type Clip } from "./clip-reels";
import { getClientId, fmtViews, fmtDuration, timeAgo, cleanTitle, type FeedVideo } from "@/components/feed/client";

/**
 * Clips hub with two feeds:
 *   • Shorts  → native uploaded vertical clips (ClipReels, autoplay reels)
 *   • Videos  → the curated fight-video catalog (/api/feed, landscape grid)
 * A floating centre toggle switches between them; it sits in the empty centre of
 * the reels' top bar so it never collides with the mute/upload controls.
 */
export function ClipsExperience({ initialClips, initialCursor }: { initialClips: Clip[]; initialCursor: string | null }) {
  const [tab, setTab] = useState<"shorts" | "videos">("shorts");
  const [videos, setVideos] = useState<FeedVideo[] | null>(null);
  const [modal, setModal] = useState<FeedVideo | null>(null);
  const cid = useRef("anon");

  useEffect(() => { cid.current = getClientId(); }, []);

  const loadVideos = useCallback(async () => {
    try {
      const res = await fetch(`/api/feed?sort=top&cid=${cid.current}`);
      const d = (await res.json()) as { videos: FeedVideo[] };
      setVideos(d.videos ?? []);
    } catch { setVideos([]); }
  }, []);

  useEffect(() => { if (tab === "videos" && videos === null) loadVideos(); }, [tab, videos, loadVideos]);

  return (
    <div className="relative">
      {/* Shorts / Videos toggle — in-flow at the top of the Clips content so it
          sits below the shell top bar + section tabs (not hidden behind them). */}
      <div className="sticky top-0 z-20 flex justify-center border-b border-ink-800 bg-ink-950/95 px-4 py-2.5 backdrop-blur-md">
        <div className="flex gap-1 rounded-full border border-ink-700 bg-ink-900 p-1">
          {(["shorts", "videos"] as const).map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "rounded-full px-5 py-1.5 font-display text-[0.75rem] font-bold uppercase tracking-wide transition-colors",
                tab === id ? "bg-chalk text-ink-950" : "text-mist hover:text-chalk",
              )}
            >
              {id === "shorts" ? "Shorts" : "Videos"}
            </button>
          ))}
        </div>
      </div>

      {tab === "shorts" ? (
        <ClipReels initial={initialClips} initialCursor={initialCursor} />
      ) : (
        <div className="mx-auto w-full max-w-2xl px-4 pb-8 pt-4 lg:max-w-5xl">
          {videos === null ? (
            <div className="flex items-center justify-center gap-2 py-24 text-mist"><Loader2 className="size-5 animate-spin" /> Loading videos…</div>
          ) : videos.length === 0 ? (
            <div className="py-24 text-center text-mist">No videos available right now.</div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {videos.map((v) => (
                <button key={v.id} onClick={() => setModal(v)} className="group overflow-hidden rounded-2xl border border-ink-800 bg-ink-900 text-left transition-colors hover:border-blood-500/50">
                  <span className="relative block aspect-video w-full overflow-hidden bg-ink-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
                      <span className="grid size-12 place-items-center rounded-full bg-white/90"><Play className="ml-0.5 size-5 fill-ink-950 text-ink-950" /></span>
                    </span>
                    {fmtDuration(v) && <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-[0.65rem] font-semibold text-white">{fmtDuration(v)}</span>}
                  </span>
                  <span className="block p-3">
                    <span className="line-clamp-2 text-[0.85rem] font-semibold leading-snug text-chalk">{cleanTitle(v.title)}</span>
                    <span className="mt-1.5 block truncate text-[0.72rem] text-mist">{cleanTitle(v.channel)}{v.viewCount ? ` · ${fmtViews(v.viewCount)} views` : ""} · {timeAgo(v.publishedAt)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {modal && <VideoModal v={modal} onClose={() => setModal(null)} />}
    </div>
  );
}

function VideoModal({ v, onClose }: { v: FeedVideo; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4" onClick={onClose}>
      <div className="w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-4">
          <p className="line-clamp-1 font-display font-semibold text-chalk">{cleanTitle(v.title)}</p>
          <button onClick={onClose} aria-label="Close" className="flex size-9 items-center justify-center rounded-full border border-ink-700 bg-ink-850 text-chalk"><X className="size-5" /></button>
        </div>
        <div className="aspect-video w-full overflow-hidden rounded-2xl border border-ink-700 bg-black">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&rel=0`}
            className="size-full"
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      </div>
    </div>
  );
}
