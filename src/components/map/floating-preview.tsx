"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CARD_GAP, CARD_EDGE, previewCardWidth, previewCardTop, previewHeightBudget,
} from "./event-card-layout";

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

// The box maths lives in event-card-layout beside the card's own sizing, so the
// narrow case can be tested without a DOM — see previewCardWidth.
const GAP = CARD_GAP;
const EDGE = CARD_EDGE;

/** What the parent calls to re-place the card without re-rendering anything. */
export interface PreviewHandle {
  reposition: () => void;
}

export function FloatingPreview({
  getAnchor,
  getBottomInset,
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
  /**
   * Pixels at the FOOT of the container that something else already owns.
   *
   * ── The bug this closes ───────────────────────────────────────────────────
   * On a phone the bottom sheet is a sibling of this card inside the same map
   * box, and it is drawn on top (z-450 against z-440). The height budget below
   * was computed from the container's FULL height, so a card placed "inside the
   * container" was routinely placed inside the part of it the sheet covers —
   * and the sheet is opaque. With the sheet at its half detent the bottom of
   * every card, "View event" included, was simply behind it, and no amount of
   * scrolling the card's own body could reach a button the sheet was over.
   *
   * A getter rather than a number for the same reason as `getAnchor`: it is
   * read during layout and must never be a stale prop.
   */
  getBottomInset?: () => number;
  /** Filled with a handle the parent calls on map movement. */
  handleRef?: React.RefObject<PreviewHandle | null>;
  contentKey: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The scrolling box. Separate from `ref` so the close button can sit OUTSIDE
  // it and stay pinned while the card's body scrolls — a close button that
  // scrolls out of reach on the one layout that needs scrolling is worse than
  // no cap at all.
  const scrollRef = useRef<HTMLDivElement>(null);
  // Read through a ref so `place` never goes stale and never needs to be a
  // dependency that re-runs effects.
  const getAnchorRef = useRef(getAnchor);
  useEffect(() => { getAnchorRef.current = getAnchor; });
  const getBottomInsetRef = useRef(getBottomInset);
  useEffect(() => { getBottomInsetRef.current = getBottomInset; });

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
    const { width: w, narrow } = previewCardWidth(W);
    el.style.width = `${w}px`;

    // ── The height BUDGET ────────────────────────────────────────────────
    // Without this the card was laid out at whatever height its content
    // wanted and then positioned inside a box that might be smaller. On a
    // phone an event card runs to roughly 500px against a 72dvh map — about
    // 480px on a 667px viewport — so the bottom of the card, including both
    // its actions, was simply clipped by the map's `overflow-hidden`. There
    // was no scrollbar to find it with, because nothing was scrollable: the
    // card genuinely extended past the container.
    //
    // Capping here and letting the body scroll makes the card fit BY
    // CONSTRUCTION at any viewport, including landscape phones where the map
    // is only a couple of hundred pixels tall.
    //
    // `inset` is the second half of that: the container is not all free space
    // on a phone — the bottom sheet is drawn OVER its foot. See getBottomInset.
    const inset = Math.max(0, Math.min(getBottomInsetRef.current?.() ?? 0, H));
    const budget = previewHeightBudget(H, inset);
    const scroller = scrollRef.current;
    if (scroller) scroller.style.maxHeight = `${budget}px`;

    // Measured AFTER the cap is applied, so the flip decision below is made
    // against the height the card will actually have.
    const h = Math.min(el.offsetHeight || 340, budget);

    // Prefer the right of the pin; flip left when the card would overhang.
    // Phones have no room to either side, so the card is centred over the pin.
    const right = anchor.x + GAP;
    const left = anchor.x - GAP - w;
    const x = narrow
      ? Math.min(Math.max(anchor.x - w / 2, EDGE), Math.max(EDGE, W - w - EDGE))
      : right + w + EDGE <= W ? right : left >= EDGE ? left : Math.max(EDGE, W - w - EDGE);

    // Vertical placement is pure and tested — see previewCardTop.
    const y = previewCardTop({ containerH: H, bottomInset: inset, anchorY: anchor.y, cardH: h, narrow });

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
      {/* The SCROLLER. maxHeight is written by `place` from the container's
          real height, so the card can never be taller than the map it sits in.
          `overscroll-contain` stops a flick that reaches the end of the card
          from continuing into the page behind it. */}
      <div
        ref={scrollRef}
        className="hide-scrollbar overflow-y-auto overscroll-contain rounded-xl"
      >
        <div
          key={contentKey}
          className="relative motion-safe:animate-[crPreviewSwap_0.2s_ease-out_both]"
        >
          {children}
        </div>
      </div>

      {/* Outside the scroller on purpose — see scrollRef. Absolute against the
          shell, so it stays put however far the body is scrolled.

          ── Why it is red and 36px ──
          It was a 28px box holding a 14px glyph in `text-mist`, sitting on top
          of a poster. On a phone that is both under the 44px touch minimum and
          low-contrast against whatever art happens to be behind it — the one
          control that has to work on every card was the hardest one on the card
          to see or hit. Blood-red is the app's only "this dismisses something"
          colour, and it reads against any poster. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        className="tap absolute right-1.5 top-1.5 z-10 grid size-9 place-items-center rounded-lg bg-blood-500/90 text-white shadow-[0_2px_10px_rgba(5,7,10,0.6)] backdrop-blur-sm transition-colors hover:bg-blood-400"
      >
        <X className="size-5" strokeWidth={2.5} />
      </button>

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
