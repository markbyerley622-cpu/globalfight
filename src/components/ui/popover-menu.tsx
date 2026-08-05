"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════
//  Anchored menu that CANNOT be clipped by an ancestor.
//
//  The bug this exists to kill: Share and Add-to-Calendar both rendered their menu
//  as `absolute right-0 mt-2` inside the event card, and the card is
//  `card-surface … overflow-hidden`. The menu opened correctly, below the button,
//  in the card's last row — i.e. entirely outside the card's box, where
//  `overflow-hidden` clipped it away. Nothing appeared. `z-50` cannot help: a
//  stacking index does not escape a clipping ancestor.
//
//  On desktop this was survivable because the pages with room rendered the same
//  components outside a clipped box. On a phone the action row is always the bottom
//  row of the card, so the menu was always clipped — which read as "the dropdown is
//  laggy / renders late", because the only feedback was the native sheet or nothing.
//
//  Fixing the card's overflow was the wrong lever: `overflow-hidden` is what keeps
//  the poster artwork inside the rounded corners. Instead the menu goes in a PORTAL
//  at document.body with fixed positioning, so no ancestor's overflow, transform or
//  stacking context can touch it. It also flips above the anchor when there is no
//  room below, which is the common case for a card low in the viewport.
//
//  Opening is synchronous and unanimated by design: this is a menu the user
//  explicitly asked for, and an entrance transition on it is indistinguishable from
//  latency.
//
//  Position is written STRAIGHT TO THE NODE'S STYLE, never held in state. Scroll and
//  resize reposition the menu, and those fire continuously — routing each one
//  through setState would re-render the menu (and its items) dozens of times a
//  second while the user scrolls, which is the very jank this component is meant to
//  remove. Imperatively positioning a portalled overlay is the sanctioned "update an
//  external system from an effect" case.
// ════════════════════════════════════════════════════════════════════════

/** Gap between the anchor and the menu, px. */
const OFFSET = 6;
/** Keep the menu this far from any viewport edge, px. */
const MARGIN = 8;
/** Height assumed for the pre-measurement frame; only used if offsetHeight is 0. */
const ESTIMATED_HEIGHT = 240;

export function PopoverMenu({
  open,
  onClose,
  anchorRef,
  children,
  width = 208,
  align = "end",
  className,
  label,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  /** Menu width in px. Fixed, so the first paint is already correctly placed. */
  width?: number;
  /** Horizontal alignment against the anchor. */
  align?: "start" | "end";
  className?: string;
  label?: string;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;

    const a = anchor.getBoundingClientRect();
    const h = menu.offsetHeight || ESTIMATED_HEIGHT;

    const below = window.innerHeight - a.bottom - MARGIN;
    const above = a.top - MARGIN;
    // Flip up only when below genuinely cannot fit AND above is roomier — flipping
    // on a 2px difference feels unstable.
    const flip = below < h && above > below;

    const top = flip ? Math.max(MARGIN, a.top - h - OFFSET) : a.bottom + OFFSET;
    const rawLeft = align === "end" ? a.right - width : a.left;
    const left = Math.min(Math.max(MARGIN, rawLeft), window.innerWidth - width - MARGIN);

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    // Only revealed once it has a real measured position, so the menu is never
    // visible for a frame at the wrong place.
    menu.style.visibility = "visible";
  }, [anchorRef, align, width]);

  // Place BEFORE the browser paints. This is the whole reason for useLayoutEffect:
  // the node must already be in the DOM (so it can be measured) but must not have
  // been painted at an unplaced position.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      // A tap on the trigger is the trigger's own toggle; closing here as well would
      // make the second tap a no-op (close, then immediately re-open).
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };

    // `pointerdown` rather than `mousedown`: on touch, `mousedown` is a synthesised
    // compatibility event that arrives after the tap, so dismissal felt delayed.
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    // Follow the anchor rather than closing. Closing a menu because the page moved a
    // pixel — which a mobile URL bar does constantly — is its own bug. `capture` so
    // scrolls in any scrollable ancestor count, not just the window.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place, onClose, anchorRef]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      // `visibility: hidden` is the initial paint state; the layout effect measures
      // and reveals it in the same frame.
      style={{ position: "fixed", top: 0, left: 0, width, visibility: "hidden" }}
      className={cn(
        "z-[100] overflow-hidden rounded-card border border-ink-700 bg-ink-900 p-1.5 shadow-2xl shadow-black/50",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Shared row styling, so every menu in the product has identical hit targets. */
export const popoverItemClass =
  "flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-mist transition-colors hover:bg-ink-800 hover:text-chalk focus-visible:bg-ink-800 focus-visible:text-chalk focus-visible:outline-none";
