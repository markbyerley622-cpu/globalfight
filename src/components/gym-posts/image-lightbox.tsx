"use client";

import { useCallback, useEffect, useRef } from "react";
import Image from "next/image";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import type { PostMediaDTO } from "@/lib/gym-posts/types";

// ════════════════════════════════════════════════════════════════════════════
//  Full-screen viewer.
//
//  ── Why a plain fixed overlay and not the app's Sheet ────────────────────
//  The notification Sheet uses a backdrop-filter, and an ancestor with
//  `backdrop-filter` creates a containing block for `position: fixed`
//  descendants — so a fixed overlay inside one is positioned against that
//  ancestor rather than the viewport and lands in the wrong place. This mounts
//  at the top of the card's own stacking context with no filtered ancestor.
//
//  ── Accessibility is not decoration here ─────────────────────────────────
//  A lightbox traps a keyboard user by construction, so it has to be a real
//  dialog: focus moves in on open, Tab cycles inside, Escape closes, and focus
//  returns to the thumbnail that opened it. Without the return, a keyboard user
//  who closes it is dumped at the top of the document.
// ════════════════════════════════════════════════════════════════════════════

export function ImageLightbox({
  media,
  index,
  onClose,
  onIndexChange,
}: {
  media: PostMediaDTO[];
  index: number;
  onClose: () => void;
  onIndexChange: (next: number) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const current = media[index];

  const go = useCallback(
    (delta: number) => {
      const next = (index + delta + media.length) % media.length;
      onIndexChange(next);
    },
    [index, media.length, onIndexChange],
  );

  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    panel.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); go(1); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); return; }
      if (e.key !== "Tab") return;

      // Focus trap. Without it, Tab walks out of the overlay into the page
      // behind, where the reader cannot see what is focused.
      const focusable = panel.current?.querySelectorAll<HTMLElement>(
        'button, [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener("keydown", onKey);
    // The app's real scroller is #main, not the document — locking `body`
    // would do nothing here. See components/layout/scroll-restoration.
    const main = document.getElementById("main");
    const previous = main?.style.overflow;
    if (main) main.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      if (main) main.style.overflow = previous ?? "";
      returnTo.current?.focus?.();
    };
  }, [go, onClose]);

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/92 p-4"
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={current.alt ?? "Photo"}
        tabIndex={-1}
        className="relative flex max-h-full w-full max-w-4xl flex-col outline-none"
        // The backdrop closes; the panel must not, or a mis-click on the photo
        // itself would dismiss it.
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          <Image
            src={current.url}
            alt={current.alt ?? ""}
            width={current.width || 1600}
            height={current.height || 1200}
            className="max-h-[80vh] w-auto object-contain"
            unoptimized
            priority
          />
        </div>

        {current.caption && (
          <p className="mt-3 text-center text-sm text-mist">{current.caption}</p>
        )}
        {media.length > 1 && (
          <p className="mt-1 text-center text-2xs tabular-nums text-fog">
            {index + 1} / {media.length}
          </p>
        )}

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="tap absolute right-0 top-0 grid size-11 place-items-center rounded-full bg-ink-900/80 text-chalk transition-colors hover:bg-ink-800"
        >
          <X className="size-5" />
        </button>

        {media.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous photo"
              className="tap absolute left-0 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-ink-900/80 text-chalk transition-colors hover:bg-ink-800"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next photo"
              className="tap absolute right-0 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-ink-900/80 text-chalk transition-colors hover:bg-ink-800"
            >
              <ChevronRight className="size-5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
