"use client";

import { useState } from "react";
import Image from "next/image";
import type { PostMediaDTO } from "@/lib/gym-posts/types";
import { ImageLightbox } from "./image-lightbox";

// ════════════════════════════════════════════════════════════════════════════
//  The images on a post.
//
//  ── Why the aspect ratio is reserved from the DATA ───────────────────────
//  Every tile is wrapped in a box sized from the asset's intrinsic width and
//  height, which the media lifecycle now records. Without that the card is one
//  height before the image loads and another after, every row below it jumps,
//  and on a feed the reader is scrolling through, the thing they were reading
//  moves out from under them. This is the whole reason MediaAsset carries
//  dimensions at all.
//
//  A missing dimension (an asset from before they were recorded) falls back to
//  4:3 rather than to nothing — a wrong-but-stable box beats a collapsing one.
//
//  ── Scroll-snap rather than a JS carousel ────────────────────────────────
//  A native overflow-x container with snap points gives momentum, touch, and
//  keyboard scrolling for free, and it costs no main-thread work while the
//  reader flicks through a feed. A JS carousel would re-implement all three,
//  worse.
// ════════════════════════════════════════════════════════════════════════════

export function MediaCarousel({ media, priority = false }: { media: PostMediaDTO[]; priority?: boolean }) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  if (media.length === 0) return null;

  const single = media.length === 1;

  return (
    <>
      <div
        className={
          single
            ? "mt-3"
            : "mt-3 -mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        }
        role={single ? undefined : "group"}
        aria-label={single ? undefined : `${media.length} photos`}
      >
        {media.map((m, i) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setLightbox(i)}
            className={`tap relative block overflow-hidden rounded-card border border-ink-800 bg-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400 ${
              single ? "w-full" : "w-[82%] shrink-0 snap-center sm:w-[62%]"
            }`}
            style={{ aspectRatio: aspectOf(m) }}
            aria-label={m.alt ? `View: ${m.alt}` : `View photo ${i + 1}`}
          >
            <Image
              src={single ? m.url : m.thumbUrl}
              alt={m.alt ?? ""}
              fill
              sizes={single ? "(max-width: 768px) 100vw, 640px" : "(max-width: 768px) 82vw, 400px"}
              className="object-cover"
              // Only the first image of the first card is eager. Everything else
              // is lazy, which is what keeps a long feed from opening dozens of
              // connections as the reader flicks past.
              loading={priority && i === 0 ? "eager" : "lazy"}
              priority={priority && i === 0}
              unoptimized
            />
          </button>
        ))}
      </div>

      {media.length > 1 && (
        <p className="mt-1.5 text-2xs text-fog">{media.length} photos — swipe</p>
      )}
      {media.some((m) => m.caption) && single && media[0].caption && (
        <p className="mt-1.5 text-xs leading-relaxed text-fog">{media[0].caption}</p>
      )}

      {lightbox !== null && (
        <ImageLightbox
          media={media}
          index={lightbox}
          onIndexChange={setLightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}

/**
 * A CSS aspect-ratio for the tile.
 *
 * Clamped: a 1:9 panorama or a 9:1 tower would otherwise own the entire screen
 * or render as a sliver. The image is object-cover inside the clamped box, so
 * the crop is visible in the lightbox at full ratio.
 */
function aspectOf(m: PostMediaDTO): string {
  if (!m.width || !m.height) return "4 / 3";
  const ratio = m.width / m.height;
  const clamped = Math.min(Math.max(ratio, 0.6), 1.91);
  return `${clamped} / 1`;
}
