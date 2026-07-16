"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared overlay primitive for the app shell.
 *
 * Mobile: slides up as a bottom sheet (rounded top, safe-area padding).
 * `sm+`: renders as a centered modal card.
 *
 * Mirrors the ad-hoc pattern in `feed/save-sheet.tsx` (backdrop click-close,
 * Escape, safe-area) but shared. Sits at `z-[100]` — above the shell chrome
 * (`z-40`) and level with `SearchOverlay`, but BELOW the feed immersive band
 * (`z-[120–150]`) so reels/player/upload still cover it as intended.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-ink-950/70 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className={cn(
          "w-full max-w-md animate-[sheet-up_.3s_cubic-bezier(.2,.8,.2,1)] overflow-y-auto border border-ink-700 bg-ink-900",
          "max-h-[92dvh] rounded-t-3xl pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
          "sm:max-h-[85dvh] sm:rounded-3xl sm:pb-6",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2.5 mb-1 h-1 w-10 rounded-full bg-ink-600 sm:hidden" />
        {title !== undefined && (
          <div className="flex items-center justify-between px-5 pb-3 pt-2">
            <h2 className="font-display text-xl font-bold uppercase tracking-tight text-chalk">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="flex size-9 items-center justify-center rounded-xl border border-ink-700 bg-ink-800 text-mist transition-colors hover:text-chalk"
            >
              <X className="size-4" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
