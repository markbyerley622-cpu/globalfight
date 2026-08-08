"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-client";
import { prefetchEntity } from "@/lib/rich-text/cache";
import { entityPreviewable, type EntityPlugin } from "@/lib/rich-text/registry";
import type { RichEntity } from "@/lib/rich-text/types";
import { closeNow, requestClose, requestOpen } from "./store";

// ════════════════════════════════════════════════════════════════════════════
//  Binding ONE chip to the preview system.
//
//  Every input reaches the same card:
//
//    desktop     hover           pointerenter → delay → open
//    mobile      long press      pointerdown  → 450ms → open, and the tap that
//                                would have followed is swallowed
//    keyboard    focus           focus → open immediately, Escape closes
//
//  ── Why long-press rather than tap on mobile ──────────────────────────────
//  A chip is a LINK. Tapping it must navigate — that is what it looks like it
//  does, and hijacking the tap to show a card instead is the interaction people
//  complain about most in apps that do this. So the tap keeps its meaning and
//  the preview is the deliberate gesture on top of it.
//
//  ── Why the prefetch is on ENTER and not on open ──────────────────────────
//  The request goes out the moment the pointer arrives; the card opens 180ms
//  later. On any normal connection the answer is already in the cache by then,
//  so the card opens with content instead of a spinner. If the reader moves on,
//  the last subscriber leaves and the request is aborted — see lib/cache.
// ════════════════════════════════════════════════════════════════════════════

/** How long a press must be held before it counts as "show me this". */
const LONG_PRESS_MS = 450;

/** How far a finger may travel and still be a press rather than a scroll. */
const LONG_PRESS_SLOP_PX = 10;

export interface EntityHoverBinding {
  /** Spread onto the chip. Empty when the kind has no preview. */
  props: Record<string, unknown>;
}

/**
 * @param plugin Nullable so the caller can invoke this before deciding whether
 *   the kind is registered — a hook must not sit behind an early return.
 */
export function useEntityHover(
  entity: RichEntity,
  plugin: EntityPlugin | null,
): EntityHoverBinding {
  // The viewer, for the plugin's own affordance gate below. Never a security
  // decision — the preview endpoint re-derives what this reader may see — but
  // it stops a kind that is certain to be refused from firing a request per
  // chip on a page full of them.
  const { user } = useAuth();
  const ref = useRef<HTMLElement | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  // Set when a long press opened a card, so the click that the browser
  // synthesises afterwards can be swallowed rather than navigating away from
  // the card the press just asked for.
  const suppressClick = useRef(false);

  // Three conditions, asked of the registry rather than decided here:
  //   • the kind is registered and declares a preview;
  //   • its plugin is willing to preview for THIS viewer (`mayPreview`);
  //   • the entity has an id at all — a legacy span carries none (see
  //     segment.ts), so there is nothing to look up. It still renders and still
  //     links by handle; it simply cannot preview.
  const previewable =
    plugin !== null &&
    entity.id !== "" &&
    entityPreviewable(entity, { signedIn: Boolean(user) });

  const cancelPress = useCallback(() => {
    if (pressTimer.current !== null) { clearTimeout(pressTimer.current); pressTimer.current = null; }
    pressOrigin.current = null;
  }, []);

  // Timers must not outlive the chip: a feed unmounts rows constantly, and a
  // pending long-press on a removed node would open a card anchored to an
  // element no longer in the document.
  useEffect(() => cancelPress, [cancelPress]);

  const open = useCallback(
    (via: "pointer" | "keyboard" | "touch") => {
      const anchor = ref.current;
      if (!anchor) return;
      requestOpen({ entity, anchor, via });
    },
    [entity],
  );

  if (!previewable) return { props: {} };

  const props: Record<string, unknown> = {
    ref: (node: HTMLElement | null) => { ref.current = node; },

    // ── Pointer (mouse, trackpad, pen) ───────────────────────────────────
    onPointerEnter: (e: React.PointerEvent) => {
      // Touch raises pointerenter too, immediately before pointerdown. Letting
      // it through would make every tap open a card, which is precisely the
      // behaviour the long-press design avoids.
      if (e.pointerType === "touch") return;
      prefetchEntity(entity);
      open("pointer");
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType === "touch") return;
      requestClose();
    },

    // ── Touch: long press ────────────────────────────────────────────────
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") return;
      prefetchEntity(entity);
      pressOrigin.current = { x: e.clientX, y: e.clientY };
      pressTimer.current = setTimeout(() => {
        pressTimer.current = null;
        suppressClick.current = true;
        open("touch");
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      // A finger that has started travelling is scrolling, not pressing.
      const origin = pressOrigin.current;
      if (!origin) return;
      if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > LONG_PRESS_SLOP_PX) cancelPress();
    },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,

    // The OS text-selection callout would fire at almost the same moment as the
    // long press and cover the card with a "Copy / Share" menu.
    onContextMenu: (e: React.MouseEvent) => {
      if (suppressClick.current) e.preventDefault();
    },

    onClick: (e: React.MouseEvent) => {
      if (!suppressClick.current) return;
      // The press already did something. Navigating now would replace the card
      // with the page it describes, which is the opposite of what was asked.
      suppressClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    },

    // ── Keyboard ─────────────────────────────────────────────────────────
    // Focus opens immediately: a reader tabbing through a body has already
    // committed to this chip, and a delay on a keyboard is just latency.
    onFocus: () => { prefetchEntity(entity); open("keyboard"); },
    onBlur: () => { requestClose(); },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") { closeNow(); return; }
      // The card is not in the tab order (it would put a dozen stops between
      // one word and the next), so this is how a keyboard reader reaches it.
      if (e.key === "ArrowDown" && !e.altKey) {
        e.preventDefault();
        open("keyboard");
        // Focus moves on the next frame, once the card has been painted.
        requestAnimationFrame(() => {
          document.querySelector<HTMLElement>("[data-entity-card] [data-card-focus]")?.focus();
        });
      }
    },
  };

  return { props };
}
