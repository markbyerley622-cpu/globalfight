"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  Apple-Maps-style bottom sheet.
//
//  Three detents — collapsed / half / expanded — that the user drags between,
//  over a map that stays interactive the whole time. This is why the Location
//  pillar never navigates away: selecting anything expands the sheet instead of
//  pushing a route, so map context is never lost.
//
//  Deliberately not the app's `Sheet` primitive: that one is a MODAL (backdrop,
//  aria-modal, Escape-to-close, blocks the page behind it). Here the surface
//  behind the sheet is the point — dimming or trapping focus over the map would
//  break the interaction rather than support it.
// ════════════════════════════════════════════════════════════════════════════

export type Detent = "collapsed" | "half" | "expanded";

/** Sheet height as a fraction of the container, per detent. */
const HEIGHT: Record<Detent, number> = { collapsed: 0.16, half: 0.5, expanded: 0.92 };

const ORDER: Detent[] = ["collapsed", "half", "expanded"];

export function BottomSheet({
  detent,
  onDetentChange,
  header,
  children,
  className,
}: {
  detent: Detent;
  onDetentChange: (d: Detent) => void;
  /** Always-visible content in the grabber area (search, title, counts). */
  header?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ startY: number; startH: number; h: number } | null>(null);

  const containerH = () => ref.current?.parentElement?.clientHeight ?? 0;

  const settle = useCallback(
    (px: number) => {
      const total = containerH();
      if (!total) return;
      const frac = px / total;
      // Snap to whichever detent the gesture ended nearest.
      let best: Detent = "collapsed";
      let bestGap = Infinity;
      for (const d of ORDER) {
        const gap = Math.abs(HEIGHT[d] - frac);
        if (gap < bestGap) { bestGap = gap; best = d; }
      }
      onDetentChange(best);
    },
    [onDetentChange],
  );

  // Drag handling lives on the grabber, not the body: a drag that started on
  // the list would fight the list's own scrolling.
  const onPointerDown = (e: React.PointerEvent) => {
    const total = containerH();
    if (!total) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ startY: e.clientY, startH: HEIGHT[detent] * total, h: HEIGHT[detent] * total });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const total = containerH();
    const next = Math.max(
      HEIGHT.collapsed * total,
      Math.min(HEIGHT.expanded * total, drag.startH - (e.clientY - drag.startY)),
    );
    setDrag({ ...drag, h: next });
  };

  const endDrag = () => {
    if (!drag) return;
    settle(drag.h);
    setDrag(null);
  };

  /** Tapping the grabber cycles up, then wraps back to collapsed at the top. */
  const cycle = () => {
    const i = ORDER.indexOf(detent);
    onDetentChange(ORDER[(i + 1) % ORDER.length]);
  };

  // A collapsed sheet must not keep an old scroll position — reopening it
  // half-way down its own list looks like a rendering fault.
  useEffect(() => {
    if (detent === "collapsed" && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [detent]);

  const height = drag ? `${drag.h}px` : `${HEIGHT[detent] * 100}%`;

  return (
    <div
      ref={ref}
      style={{ height }}
      className={cn(
        "absolute inset-x-0 bottom-0 z-[450] flex flex-col overflow-hidden rounded-t-2xl border-t border-ink-700 bg-ink-950/95 backdrop-blur-xl",
        "shadow-[0_-18px_50px_-20px_rgba(0,0,0,0.95)]",
        // No transition mid-drag: animating toward a target that moves every
        // frame is what makes a hand-dragged sheet feel like rubber.
        !drag && "transition-[height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        className,
      )}
    >
      {/* Grabber */}
      <div
        role="button"
        tabIndex={0}
        aria-label={`Sheet: ${detent}. Drag or press to resize.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={(e) => { if (!drag) { e.stopPropagation(); cycle(); } }}
        onKeyDown={(e) => {
          const i = ORDER.indexOf(detent);
          if (e.key === "ArrowUp" && i < ORDER.length - 1) { e.preventDefault(); onDetentChange(ORDER[i + 1]); }
          if (e.key === "ArrowDown" && i > 0) { e.preventDefault(); onDetentChange(ORDER[i - 1]); }
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cycle(); }
        }}
        className="shrink-0 cursor-grab touch-none select-none px-4 pb-1 pt-2 active:cursor-grabbing"
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-ink-600" />
      </div>

      {header && <div className="shrink-0 px-4 pb-2 pt-1">{header}</div>}

      <div ref={scrollRef} className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {children}
      </div>
    </div>
  );
}
