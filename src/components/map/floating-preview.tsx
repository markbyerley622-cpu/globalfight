"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  The desktop floating preview — the SHELL, not the content.
//
//  ── Why this is separate from EventMapPreview ─────────────────────────────
//  Two different jobs. EventMapPreview knows what an event looks like; this
//  knows where a card sits, which way it flips near an edge, and how it swaps
//  when you pick a different pin. Keeping them apart means the same card
//  renders in the mobile sheet and in this desktop shell with no branching
//  inside it, and this shell would host a gym preview unchanged.
//
//  ── Why anchoring needs per-frame updates ─────────────────────────────────
//  The card is pinned to its marker's SCREEN position, which changes on every
//  frame of a pan or a flyTo. The parent drives that through `anchor`, which it
//  recomputes on the canvas's `move`/`zoom` events. Positioning is written
//  straight to the DOM node in a layout effect rather than through React state:
//  a setState per animation frame during a fly would queue a render per frame
//  for a transform React does not need to know about.
//
//  ── One preview at a time ─────────────────────────────────────────────────
//  Enforced by construction — this component renders exactly one card and the
//  explorer holds exactly one selection. There is no list of open previews to
//  get out of sync.
// ════════════════════════════════════════════════════════════════════════════

export interface Anchor {
  /** Pixels from the left of the map container. */
  x: number;
  /** Pixels from the top of the map container. */
  y: number;
}

/** Card box. Kept here because the flip maths needs the real numbers. */
const CARD_W = 340;
const GAP = 18;
const EDGE = 12;

/**
 * Below this container width there is no room BESIDE a pin for a 340px card,
 * so the layout changes: the card sits ABOVE the pin, centred, and shrinks to
 * fit. That is the phone case.
 */
const NARROW = CARD_W + GAP + EDGE * 2;

/** What the parent calls to re-place the card without re-rendering anything. */
export interface PreviewHandle {
  reposition: () => void;
}

export function FloatingPreview({
  getAnchor,
  handleRef,
  /**
   * Identity of what is being shown. A CHANGE swaps the content with a
   * cross-fade; the shell itself is never unmounted, which is what keeps the
   * swap continuous instead of a destroy-and-recreate.
   */
  contentKey,
  onClose,
  children,
  className,
}: {
  /**
   * Reads the pin's CURRENT screen position, straight from the map.
   *
   * ── Why a getter and not an `anchor` prop ─────────────────────────────────
   * The anchor changes on every frame of a pan or a flyTo. Passing it as a prop
   * meant the parent held it in state and called `setAnchor` per frame — which
   * re-rendered the whole explorer, its groups memo and every sheet row, sixty
   * times a second, to move one card by a few pixels. React never needed to
   * know this value: it is written straight to `transform` below.
   */
  getAnchor: () => Anchor | null;
  /** Filled with a handle the parent calls on map movement. */
  handleRef?: React.RefObject<PreviewHandle | null>;
  contentKey: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Read through a ref so `place` never goes stale and never needs to be a
  // dependency that re-runs effects.
  const getAnchorRef = useRef(getAnchor);
  useEffect(() => { getAnchorRef.current = getAnchor; });

  /**
   * Place the card next to its pin, flipping to whichever side has room.
   *
   * Written directly to `style` rather than through state — see above.
   */
  const place = useCallback(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;

    const anchor = getAnchorRef.current();
    // No projection yet (the map is still mounting) — hide rather than park the
    // card at stale pixels, which would show it detached from any pin.
    if (!anchor) { el.style.visibility = "hidden"; return; }
    el.style.visibility = "visible";

    const { clientWidth: W, clientHeight: H } = host;
    const h = el.offsetHeight || 340;
    const narrow = W < NARROW;
    const w = narrow ? Math.max(200, W - EDGE * 2) : CARD_W;
    el.style.width = `${w}px`;

    let x: number;
    let y: number;

    if (narrow) {
      // ── Phone: ABOVE the pin, centred ────────────────────────────────────
      // There is no room to either side, and the alternative — a bottom sheet
      // the reader has to drag open — buries the card they just asked for
      // behind a gesture. Popping it over the map is the same interaction the
      // desktop gets, which is the point.
      x = Math.min(Math.max(anchor.x - w / 2, EDGE), Math.max(EDGE, W - w - EDGE));
      const above = anchor.y - GAP - h;
      // Flip BELOW only when there is genuinely no room above — a card over the
      // pin would hide the thing it describes.
      y = above >= EDGE ? above : Math.min(anchor.y + GAP, Math.max(EDGE, H - h - EDGE));
    } else {
      // Prefer the right of the pin; flip left when the card would overhang.
      const right = anchor.x + GAP;
      const left = anchor.x - GAP - w;
      x = right + w + EDGE <= W ? right : left >= EDGE ? left : Math.max(EDGE, W - w - EDGE);
      // Vertically centred on the pin, then clamped inside the container so a
      // card never hangs off the top or bottom.
      y = Math.min(Math.max(anchor.y - h / 2, EDGE), Math.max(EDGE, H - h - EDGE));
    }

    // The tail points at the pin only when the card is BESIDE it. Above/below,
    // a side-notch would point at nothing.
    el.dataset.narrow = narrow ? "1" : "";
    el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }, []);

  // Layout effect: position before the browser paints, so the card never shows
  // for one frame at its previous coordinates.
  useLayoutEffect(place);

  // Hand the parent a way to re-place the card on map movement. A method call,
  // not a state update: moving a card must not re-render the map explorer.
  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = { reposition: place };
    return () => { handleRef.current = null; };
  }, [handleRef, place]);

  // The card's own height changes as content swaps (a card with no poster is
  // shorter), and the vertical clamp depends on it.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [place]);

  // Escape closes. Not a focus trap — the map behind stays usable on purpose,
  // which is the whole reason this is not the app's modal Sheet primitive.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      ref={ref}
      // `left/top: 0` + a transform: the position is one composited property, so
      // following a pan costs no layout.
      // Width is set imperatively in `place` — it depends on the container.
      style={{ left: 0, top: 0 }}
      className={cn(
        "absolute z-[440] will-change-transform",
        "motion-safe:animate-[crPreviewIn_0.22s_cubic-bezier(0.22,1,0.36,1)_both]",
        className,
      )}
      role="dialog"
      aria-label="Event preview"
    >
      {/* ── Swap, don't recreate ──
          The SHELL above is mounted once and never keyed, so its position, its
          entrance animation and its tail survive a change of selection. Only
          this inner box is keyed, so picking another marker re-enters the
          contents in place rather than tearing the card down and popping a new
          one somewhere else — which is what makes most map popups feel like
          browser chrome.

          Keying is also what makes it correct: React remounts the subtree, so
          the new event's poster and countdown can never be painted inside the
          previous event's already-scrolled card. */}
      <div
        key={contentKey}
        className="relative motion-safe:animate-[crPreviewSwap_0.2s_ease-out_both]"
      >
        {children}

        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="tap absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-lg bg-ink-950/80 text-mist backdrop-blur-sm transition-colors hover:text-chalk"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* The tail: a small notch pointing back at the pin, so the card reads as
          belonging to that marker rather than floating near it. Hidden on the
          narrow layout, where the card is above the pin and a side-notch would
          point at nothing. */}
      <span
        aria-hidden
        className="pointer-events-none absolute size-2.5 rotate-45 rounded-[2px] border-b border-l border-ink-700 bg-ink-950 [[data-narrow='1']_&]:hidden"
        style={{ left: -5, top: "50%", marginTop: -5 }}
      />
    </div>
  );
}
