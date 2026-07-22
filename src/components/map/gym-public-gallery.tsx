"use client";

import Image from "next/image";
import { useLightbox, type LightboxImage } from "@/components/ui/lightbox";

/**
 * The public gallery.
 *
 * Was anchors to raw image URLs opening in a new tab — which dropped a visitor
 * onto a bare .webp with no caption, no next and no way back. Now it opens the
 * shared lightbox in place.
 *
 * Tiles carry intrinsic width/height from GymPhoto, so the grid reserves its
 * boxes and nothing reflows as images arrive.
 */
export function GymPublicGallery({ photos, gymName }: { photos: LightboxImage[]; gymName: string }) {
  const lightbox = useLightbox(photos);
  if (photos.length === 0) return null;

  return (
    <>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((p, i) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => lightbox.open(i)}
              aria-label={`Open photo ${i + 1} of ${photos.length}${p.caption ? `: ${p.caption}` : ""}`}
              className="group relative block aspect-square w-full overflow-hidden rounded-xl border border-ink-700 bg-ink-850"
            >
              <Image
                src={p.thumbUrl}
                alt={p.alt ?? p.caption ?? `${gymName} photo ${i + 1}`}
                fill
                unoptimized
                loading="lazy"
                sizes="(max-width: 640px) 33vw, 160px"
                className="object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
              />
            </button>
          </li>
        ))}
      </ul>
      {lightbox.node}
    </>
  );
}
