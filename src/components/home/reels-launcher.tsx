"use client";

import { useEffect, useState } from "react";
import { Film } from "lucide-react";
import { ReelsOverlay } from "@/components/feed/reels-overlay";

/**
 * First-class Reels entry point for the Home landing. Reuses the existing
 * ReelsOverlay (full-screen vertical-swipe "reel mode") — no Feed/engine
 * changes. A slim inline bar on desktop and a floating button on mobile make
 * Reels obvious without disturbing the curated home dashboard. The last chosen
 * view is remembered so a future toggle can honour it.
 */
export function ReelsLauncher() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Remember the preference (used for button emphasis / future auto-resume).
    // Deliberately does NOT auto-open over the home dashboard.
    try {
      localStorage.setItem("cr:lastView", open ? "reels" : "feed");
    } catch {
      /* ignore */
    }
  }, [open]);

  return (
    <>
      {/* Desktop: a slim bar above the feed — visible, not overwhelming. */}
      <div className="hidden border-b border-ink-800 bg-ink-950/60 lg:block">
        <div className="container-cr flex items-center justify-between py-2.5">
          <span className="font-display text-[0.72rem] font-bold uppercase tracking-[0.2em] text-fog">Combat Feed</span>
          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-blood-500 px-4 py-2 font-display text-xs font-semibold uppercase tracking-wide text-white shadow-[0_8px_30px_-12px_rgba(225,29,42,0.8)] transition-colors hover:bg-blood-400"
          >
            <Film className="size-4" /> Reels
          </button>
        </div>
      </div>

      {/* Mobile: floating Reels button, clear of the bottom tab bar. */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Open Reels"
        className="tap fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-40 inline-flex items-center gap-2 rounded-full bg-blood-500 px-4 py-3 font-display text-xs font-bold uppercase tracking-wide text-white shadow-[0_10px_30px_-8px_rgba(225,29,42,0.85)] lg:hidden"
      >
        <Film className="size-4" /> Reels
      </button>

      <ReelsOverlay open={open} onClose={() => setOpen(false)} query={{ sort: "smart" }} />
    </>
  );
}
