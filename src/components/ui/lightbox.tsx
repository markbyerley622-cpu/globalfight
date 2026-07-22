"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  Lightbox.
//
//  The public gallery used to be links to raw image URLs opening in a new tab,
//  which throws the visitor out of the app onto a bare .webp with no caption,
//  no next, and no way back but the back button.
//
//  Behaviour that matters and is easy to get wrong:
//   · The ADJACENT images are preloaded, so next/prev is instant rather than a
//     white flash on a phone connection.
//   · Focus is trapped and restored to the thumbnail that opened it, so a
//     keyboard user is not dumped at the top of the document on close.
//   · Body scroll is locked while open — otherwise the page behind scrolls
//     under the overlay on iOS.
//   · Swipe is horizontal-dominant only, so a vertical drag to dismiss the
//     browser chrome does not skip three photos.
// ════════════════════════════════════════════════════════════════════════════

export interface LightboxImage {
  id: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  caption?: string | null;
  alt?: string | null;
  credit?: string | null;
}

export function Lightbox({
  images, index, onIndexChange, onClose,
}: {
  images: LightboxImage[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const [drag, setDrag] = useState<{ x0: number; y0: number; dx: number } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const count = images.length;
  const image = images[index];

  const go = useCallback(
    (delta: number) => {
      if (count === 0) return;
      onIndexChange((index + delta + count) % count);
    },
    [index, count, onIndexChange],
  );

  // Remember what to give focus back to, then take it.
  useEffect(() => {
    restoreFocus.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => restoreFocus.current?.focus?.();
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      // Minimal focus trap: the overlay has few controls, so cycling within it
      // is enough — no need for a full tabbable-node walker.
      if (e.key === "Tab") {
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>("button");
        if (!focusables?.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  if (!image) return null;

  // Neighbours, rendered off-screen so the browser has them decoded already.
  const neighbours = count > 1
    ? [images[(index + 1) % count], images[(index - 1 + count) % count]]
    : [];

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${index + 1} of ${count}`}
      className="fixed inset-0 z-[160] flex flex-col bg-ink-950/95 backdrop-blur-md focus:outline-none"
      onClick={onClose}
      onTouchStart={(e) => {
        const t = e.touches[0];
        setDrag({ x0: t.clientX, y0: t.clientY, dx: 0 });
      }}
      onTouchMove={(e) => {
        if (!drag) return;
        const t = e.touches[0];
        setDrag({ ...drag, dx: t.clientX - drag.x0 });
      }}
      onTouchEnd={(e) => {
        if (!drag) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - drag.x0;
        const dy = t.clientY - drag.y0;
        setDrag(null);
        // Horizontal-dominant only.
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? 1 : -1);
      }}
    >
      {/* Chrome */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <span className="font-display text-[0.72rem] font-bold uppercase tracking-wider tabular-nums text-mist">
          {index + 1} / {count}
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          aria-label="Close photo viewer"
          className="tap grid size-9 place-items-center rounded-xl border border-ink-700 bg-ink-900/80 text-mist hover:text-chalk"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Stage */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-3 py-3">
        <div
          className="relative flex size-full items-center justify-center"
          onClick={(e) => e.stopPropagation()}
          style={drag ? { transform: `translateX(${drag.dx * 0.4}px)` } : undefined}
        >
          <Image
            key={image.id}
            src={image.url}
            alt={image.alt ?? image.caption ?? ""}
            width={image.width || 1600}
            height={image.height || 1200}
            unoptimized
            priority
            className="max-h-full w-auto max-w-full rounded-lg object-contain"
          />
        </div>

        {count > 1 && (
          <>
            <NavButton side="left" onClick={() => go(-1)} />
            <NavButton side="right" onClick={() => go(1)} />
          </>
        )}
      </div>

      {/* Caption */}
      {(image.caption || image.credit) && (
        <div
          className="shrink-0 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-1 text-center"
          onClick={(e) => e.stopPropagation()}
        >
          {image.caption && <p className="text-sm leading-relaxed text-chalk">{image.caption}</p>}
          {image.credit && <p className="mt-0.5 text-[0.7rem] text-fog">📷 {image.credit}</p>}
        </div>
      )}

      {/* Preload neighbours — off-screen, not display:none, so they decode. */}
      <div aria-hidden className="pointer-events-none absolute size-px overflow-hidden opacity-0">
        {neighbours.map((n) => (
          <Image key={n.id} src={n.url} alt="" width={16} height={16} unoptimized />
        ))}
      </div>
    </div>
  );
}

function NavButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label={side === "left" ? "Previous photo" : "Next photo"}
      className={cn(
        "tap absolute top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-ink-700 bg-ink-950/80 text-mist backdrop-blur transition-colors hover:text-chalk",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      <Icon className="size-5" />
    </button>
  );
}

/** Thin wrapper: owns the open/index state so callers just render a grid. */
export function useLightbox(images: LightboxImage[]) {
  const [index, setIndex] = useState<number | null>(null);
  const open = useCallback((i: number) => setIndex(i), []);
  const close = useCallback(() => setIndex(null), []);
  const node =
    index === null ? null : (
      <Lightbox images={images} index={index} onIndexChange={setIndex} onClose={close} />
    );
  return { open, close, node };
}
