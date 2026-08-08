"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
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

/** A resize affordance that is actually visible. Disabled at the end stops. */
function ResizeButton({
  label, onClick, disabled, children,
}: { label: string; onClick: () => void; disabled: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      // stopPropagation: the grabber underneath cycles detents on click, so
      // without this a press on "minimise" would also fire the cycle and land
      // somewhere the user did not ask for.
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        "tap grid size-7 place-items-center rounded-md transition-colors",
        disabled ? "cursor-default text-ink-600" : "text-mist hover:bg-ink-800 hover:text-chalk",
      )}
    >
      {children}
    </button>
  );
}

/** Sheet height as a fraction of the container, per detent. */
const HEIGHT: Record<Detent, number> = { collapsed: 0.16, half: 0.5, expanded: 0.92 };

const ORDER: Detent[] = ["collapsed", "half", "expanded"];

/**
 * How far BELOW the collapsed detent a drag must travel to dismiss.
 *
 * A fraction of the container rather than a pixel count, so the gesture asks
 * for the same proportion of a small phone and a tall one. Large enough that
 * settling onto "collapsed" does not turn into an accidental dismissal.
 */
const DISMISS_MARGIN = 0.06;

export function BottomSheet({
  detent,
  onDetentChange,
  onDismiss,
  header,
  children,
  className,
}: {
  detent: Detent;
  onDetentChange: (d: Detent) => void;
  /**
   * Dragging DOWN past the collapsed detent, when supplied.
   *
   * Only meaningful when the sheet is showing something dismissable — a
   * selection. In discovery mode there is nothing to dismiss to, so the caller
   * omits this and the sheet keeps its old floor behaviour rather than
   * bottoming out into an empty screen.
   */
  onDismiss?: () => void;
  /** Always-visible content in the grabber area (search, title, counts). */
  header?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ startY: number; startH: number; h: number } | null>(null);
  /**
   * Did this gesture actually MOVE?
   *
   * ── The bug this fixes ────────────────────────────────────────────────────
   * A pointerup is followed by a click. The click handler below cycles the
   * detent, and it was guarded by `!drag` — but `endDrag` has already set drag
   * to null by the time the click fires, so the guard was always true. Every
   * drag therefore ended by snapping to the detent the gesture asked for and
   * then IMMEDIATELY cycling one further. Dragging the sheet half-way opened it
   * fully; dragging it closed reopened it. It read as the sheet fighting you.
   *
   * A ref, not state: it is written during the gesture and read in the click
   * that follows, and neither should cost a render.
   */
  const moved = useRef(false);

  const containerH = () => ref.current?.parentElement?.clientHeight ?? 0;

  const settle = useCallback(
    (px: number) => {
      const total = containerH();
      if (!total) return;
      const frac = px / total;

      // Past the dismiss threshold the gesture was "put this away", not "make
      // it smaller". Checked BEFORE snapping, because the nearest detent to a
      // flung-down sheet is always `collapsed` — snapping first would make the
      // dismissal unreachable.
      if (onDismiss && frac < HEIGHT.collapsed - DISMISS_MARGIN) {
        onDismiss();
        // Leave the sheet at its smallest detent so the NEXT thing selected
        // opens from where this one left, rather than from wherever the finger
        // happened to stop.
        onDetentChange("collapsed");
        return;
      }

      // Snap to whichever detent the gesture ended nearest.
      let best: Detent = "collapsed";
      let bestGap = Infinity;
      for (const d of ORDER) {
        const gap = Math.abs(HEIGHT[d] - frac);
        if (gap < bestGap) { bestGap = gap; best = d; }
      }
      onDetentChange(best);
    },
    [onDetentChange, onDismiss],
  );

  // Drag handling lives on the grabber, not the body: a drag that started on
  // the list would fight the list's own scrolling.
  const onPointerDown = (e: React.PointerEvent) => {
    const total = containerH();
    if (!total) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    moved.current = false;
    setDrag({ startY: e.clientY, startH: HEIGHT[detent] * total, h: HEIGHT[detent] * total });
  };

  /**
   * How far the pointer must travel before this counts as a drag.
   *
   * Below it the gesture is a TAP on the grabber, which cycles detents — a
   * press that wobbles by two pixels must not be settled to the nearest detent
   * as though it were a deliberate resize.
   */
  const DRAG_SLOP_PX = 4;

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    if (Math.abs(e.clientY - drag.startY) > DRAG_SLOP_PX) moved.current = true;
    const total = containerH();
    // The floor drops below `collapsed` only when there is something to dismiss
    // TO. Without that the sheet would rubber-band against a floor it can never
    // pass, which reads as the gesture being ignored — the drag has to actually
    // follow the finger into the dismiss zone for the dismissal to feel earned.
    const floor = (onDismiss ? HEIGHT.collapsed - DISMISS_MARGIN * 1.6 : HEIGHT.collapsed) * total;
    const next = Math.max(
      Math.max(0, floor),
      Math.min(HEIGHT.expanded * total, drag.startH - (e.clientY - drag.startY)),
    );
    setDrag({ ...drag, h: next });
  };

  const endDrag = () => {
    if (!drag) return;
    // A gesture that never moved is a TAP. Leave the detent alone and let the
    // click that follows cycle it — settling here as well would apply two
    // changes to one press.
    if (moved.current) settle(drag.h);
    setDrag(null);
  };

  /** A cancelled pointer (a system gesture taking over) resizes nothing. */
  const cancelDrag = () => {
    moved.current = false;
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
      {/* ── Grabber + explicit resize buttons ──
          The drag handle alone was the whole affordance, and a 4px bar is not a
          control most people recognise — the sheet read as something that was
          simply covering the map rather than something they could move. The two
          buttons say it outright, work with a mouse, work with a keyboard, and
          leave the drag gesture exactly as it was for anyone who does reach for
          it. */}
      <div className="relative shrink-0">
        <div
          role="button"
          tabIndex={0}
          aria-label={`Sheet: ${detent}. Drag or press to resize.`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={cancelDrag}
          onClick={(e) => {
            e.stopPropagation();
            // Checked against the GESTURE, not against `drag` — which endDrag
            // has already cleared by the time a click fires. See `moved`.
            if (moved.current) { moved.current = false; return; }
            cycle();
          }}
          onKeyDown={(e) => {
            const i = ORDER.indexOf(detent);
            if (e.key === "ArrowUp" && i < ORDER.length - 1) { e.preventDefault(); onDetentChange(ORDER[i + 1]); }
            if (e.key === "ArrowDown" && i > 0) { e.preventDefault(); onDetentChange(ORDER[i - 1]); }
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cycle(); }
          }}
          className="cursor-grab touch-none select-none px-4 pb-1 pt-2 active:cursor-grabbing"
        >
          <div className="mx-auto h-1 w-10 rounded-full bg-ink-600" />
        </div>

        <div className="absolute right-2 top-1 flex items-center gap-0.5">
          <ResizeButton
            label="Minimise list"
            disabled={detent === "collapsed"}
            onClick={() => onDetentChange(ORDER[Math.max(0, ORDER.indexOf(detent) - 1)])}
          >
            <ChevronDown className="size-4" />
          </ResizeButton>
          <ResizeButton
            label="Expand list"
            disabled={detent === "expanded"}
            onClick={() => onDetentChange(ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(detent) + 1)])}
          >
            <ChevronUp className="size-4" />
          </ResizeButton>
        </div>
      </div>

      {header && <div className="shrink-0 px-4 pb-2 pt-1">{header}</div>}

      <div ref={scrollRef} className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {children}
      </div>
    </div>
  );
}
