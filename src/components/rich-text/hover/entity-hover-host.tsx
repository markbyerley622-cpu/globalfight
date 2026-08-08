"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { entityDisplayName, entityPlugin } from "@/lib/rich-text/registry";
import { EntityPreviewCard } from "../previews";
import {
  closeNow, getOpen, getServerOpen, holdOpen, noteScroll, requestClose, subscribe,
} from "./store";

// ════════════════════════════════════════════════════════════════════════════
//  THE HOVER HOST — mounted once, renders whichever preview is open.
//
//  ── Why one host and not a card per chip ──────────────────────────────────
//  A body with twenty mentions would otherwise carry twenty positioned,
//  portalled, event-listening subtrees that are hidden 100% of the time. One
//  host means one portal, one keydown listener, one scroll listener and one
//  ResizeObserver for the whole application, and "only one card can be open" is
//  structural rather than something every chip has to cooperate on.
//
//  Mounted in the root layout. It renders nothing until something is open.
//
//  ── Positioning ──────────────────────────────────────────────────────────
//  Fixed to the viewport, flipped above the anchor when there is no room below,
//  and clamped horizontally so a chip at the right edge does not push the card
//  off screen. Written straight to `style` in a layout effect: the card is
//  positioned before it is painted, so it never appears for one frame at the
//  previous chip's coordinates.
//
//  ── Why it is NOT a focus trap ───────────────────────────────────────────
//  A hover card is not a modal. Trapping focus in something that opens on
//  POINTER MOVEMENT would take the keyboard away from a reader who never asked
//  for the card and cannot see it. Escape closes and focus returns to the chip;
//  Tab out simply closes it. That is the same contract the map's floating
//  preview uses, and for the same reason.
// ════════════════════════════════════════════════════════════════════════════

/** Card box, and the breathing room around it. */
const CARD_W = 320;
const GAP = 10;
const EDGE = 8;

export function EntityHoverHost() {
  const open = useSyncExternalStore(subscribe, getOpen, getServerOpen);
  const cardRef = useRef<HTMLDivElement>(null);
  // Where focus came from, so Escape can hand it back rather than dropping it
  // to the top of the document.
  const restoreTo = useRef<HTMLElement | null>(null);

  const place = useCallback(() => {
    const el = cardRef.current;
    const anchor = open?.anchor;
    if (!el || !anchor) return;

    const rect = anchor.getBoundingClientRect();
    // A chip inside a virtualised or unmounted row has a zero box. Hide rather
    // than park the card at 0,0 where it would sit detached from anything.
    if (rect.width === 0 && rect.height === 0) { el.style.visibility = "hidden"; return; }
    el.style.visibility = "visible";

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(CARD_W, vw - EDGE * 2);
    el.style.width = `${w}px`;

    const h = el.offsetHeight || 200;

    // Centred on the chip, then clamped inside the viewport.
    const x = Math.min(Math.max(rect.left + rect.width / 2 - w / 2, EDGE), Math.max(EDGE, vw - w - EDGE));

    // Below by preference; above when the card would overhang the fold. When
    // neither fits — a short viewport with a tall card — take the side with
    // more room and let the card's own body scroll.
    const below = rect.bottom + GAP;
    const above = rect.top - GAP - h;
    const roomBelow = vh - below;
    let y: number;
    if (h <= roomBelow) y = below;
    else if (above >= EDGE) y = above;
    else y = roomBelow >= rect.top ? below : Math.max(EDGE, rect.top - GAP - Math.min(h, rect.top - GAP));

    el.style.maxHeight = `${Math.max(140, vh - EDGE * 2)}px`;
    el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }, [open]);

  useLayoutEffect(place);

  // ── Global listeners, mounted once ────────────────────────────────────────
  useEffect(() => {
    // `capture` so a scroll inside any scroll container counts, not just the
    // document — a feed inside an overflow box does not bubble a scroll event.
    const onScroll = () => { noteScroll(); place(); };
    const onResize = () => place();
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onResize);
    };
  }, [place]);

  // Escape closes from anywhere, including from inside the card.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeNow();
      restoreTo.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Remember the chip so Escape can return focus to it.
  useEffect(() => {
    if (open?.via === "keyboard") restoreTo.current = open.anchor;
  }, [open]);

  // The card's height changes as its content lands (a spinner is shorter than a
  // loaded profile), and the flip decision depends on that height.
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [place, open]);

  // A route change must not leave a card floating over the new page. The chip
  // it was anchored to is gone, so there is nothing to point at.
  useEffect(() => {
    if (!open) return;
    const onNavigate = () => closeNow();
    window.addEventListener("popstate", onNavigate);
    return () => window.removeEventListener("popstate", onNavigate);
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const plugin = entityPlugin(open.entity.type);
  if (!plugin) return null;

  return createPortal(
    <div
      ref={cardRef}
      data-entity-card
      style={{ position: "fixed", left: 0, top: 0 }}
      className={
        "z-[600] overflow-y-auto overscroll-contain rounded-xl border border-ink-700 " +
        "bg-ink-950/97 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.95)] backdrop-blur-xl " +
        // Reduced motion is respected by using motion-safe: a reader who has
        // asked for less movement gets the card with no entrance at all.
        "motion-safe:animate-[crPreviewIn_0.16s_cubic-bezier(0.22,1,0.36,1)_both]"
      }
      // A hovered preview is supplementary, not a dialog. `role="dialog"`
      // without a focus trap lies to a screen reader about what it can do here,
      // and trapping focus in something opened by pointer movement is worse.
      // `tooltip` is what this actually is: extra detail about the chip.
      role="tooltip"
      aria-label={`${entityDisplayName(open.entity, "Entity")}, ${plugin.label} preview`}
      // The pointer travelling from chip to card must not dismiss it.
      onPointerEnter={holdOpen}
      onPointerLeave={requestClose}
    >
      <EntityPreviewCard entity={open.entity} plugin={plugin} />
    </div>,
    document.body,
  );
}
