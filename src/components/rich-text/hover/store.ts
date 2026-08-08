import type { RichEntity } from "@/lib/rich-text/types";

// ════════════════════════════════════════════════════════════════════════════
//  WHICH preview is open — one answer, for the whole application.
//
//  ── Why a module singleton ────────────────────────────────────────────────
//  "One card at a time" has to be true across trees that do not share a
//  provider: a mention in the feed and a mention inside a DM panel are rendered
//  by different subtrees, and two contexts would happily open two cards. Making
//  it a module value makes the invariant structural — there is one variable, so
//  there is one card.
//
//  It is also read and written from raw event handlers running outside React's
//  render (a pointerenter fires long before anything re-renders), which a
//  context value cannot serve without a state update per event.
//
//  ── Why intent is separated from state ────────────────────────────────────
//  `requestOpen` does not open anything; it starts the delay. Every timer in
//  the interaction lives here rather than in each chip, so a chip cannot leak
//  one — and moving between two chips cancels the first's pending open in the
//  same place it starts the second's, which is what stops a card flashing open
//  behind the reader's pointer as they cross a sentence.
// ════════════════════════════════════════════════════════════════════════════

export interface OpenPreview {
  entity: RichEntity;
  /** The chip that opened it. The card anchors to this element's box. */
  anchor: HTMLElement;
  /**
   * How it was opened.
   *
   * Drives whether the card takes focus: a KEYBOARD or LONG-PRESS open is a
   * deliberate request to inspect and the card becomes focusable, while a
   * pointer hover must never steal focus from what the reader was doing.
   */
  via: "pointer" | "keyboard" | "touch";
}

/**
 * Open delay.
 *
 * At the low end of the 150–250ms band the product asked for. Long enough that
 * crossing a chip on the way somewhere else opens nothing; short enough that a
 * deliberate hover does not feel like waiting.
 */
const OPEN_DELAY_MS = 180;

/**
 * Close grace.
 *
 * The gap between chip and card is real pixels, and a pointer crossing it must
 * not dismiss the thing it is travelling toward. Shorter than the open delay so
 * a card never lingers over content the reader has moved past.
 */
const CLOSE_DELAY_MS = 120;

/**
 * How long after a scroll previews stay suppressed.
 *
 * Scrolling drags the pointer across whatever passes under it. Without this,
 * flicking a feed opens a card for whichever chip happened to land under a
 * stationary finger or cursor — a preview nobody asked for, mid-gesture.
 */
const SCROLL_QUIET_MS = 220;

let current: OpenPreview | null = null;
let openTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let scrolledAt = 0;

const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function clearTimers(): void {
  if (openTimer !== null) { clearTimeout(openTimer); openTimer = null; }
  if (closeTimer !== null) { clearTimeout(closeTimer); closeTimer = null; }
}

// ── Subscription (useSyncExternalStore) ─────────────────────────────────────

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getOpen(): OpenPreview | null {
  return current;
}

/**
 * Server snapshot.
 *
 * Always null, and it must be a STABLE null — returning a fresh object here
 * makes useSyncExternalStore loop. Nothing is ever open during SSR: a preview
 * is a hover interaction and the first paint carries none.
 */
export function getServerOpen(): null {
  return null;
}

// ── Intent ──────────────────────────────────────────────────────────────────

/** True while a recent scroll should suppress previews. */
export function isScrollQuiet(): boolean {
  return Date.now() - scrolledAt < SCROLL_QUIET_MS;
}

/** Called by the host's global scroll listener. */
export function noteScroll(): void {
  scrolledAt = Date.now();
  // A pending open is abandoned outright. A card that was already OPEN stays —
  // the reader opened it deliberately and scrolling the page under it is not a
  // request to dismiss it; the anchor tracking keeps it in place.
  if (openTimer !== null) { clearTimeout(openTimer); openTimer = null; }
}

/**
 * Ask for a preview after the open delay.
 *
 * Immediate when a card is ALREADY open: moving from one chip to another swaps
 * the contents with no second wait, which is how a reader compares two people
 * without the interface making them pause each time.
 */
export function requestOpen(next: OpenPreview): void {
  clearTimers();
  if (current?.anchor === next.anchor) return;

  // A keyboard or long-press open is explicit — no delay, the reader has
  // already committed. Only a passing pointer has to prove its intent.
  if (next.via !== "pointer" || current !== null) {
    current = next;
    emit();
    return;
  }

  if (isScrollQuiet()) return;

  openTimer = setTimeout(() => {
    openTimer = null;
    // Re-checked at fire time: the scroll may have started during the delay.
    if (isScrollQuiet()) return;
    current = next;
    emit();
  }, OPEN_DELAY_MS);
}

/**
 * Withdraw interest.
 *
 * A PENDING open is cancelled immediately — nothing is on screen, so there is
 * nothing to be gentle about. An OPEN card gets the grace period, so the
 * pointer can travel onto it.
 */
export function requestClose(): void {
  if (openTimer !== null) { clearTimeout(openTimer); openTimer = null; }
  if (current === null) return;
  if (closeTimer !== null) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    closeTimer = null;
    current = null;
    emit();
  }, CLOSE_DELAY_MS);
}

/** The pointer reached the card. Cancel the pending dismissal. */
export function holdOpen(): void {
  if (closeTimer !== null) { clearTimeout(closeTimer); closeTimer = null; }
}

/** Close now — Escape, a click through to the link, a route change. */
export function closeNow(): void {
  clearTimers();
  if (current === null) return;
  current = null;
  emit();
}

/** Testing seam. */
export const HOVER_TIMING = {
  OPEN_DELAY_MS,
  CLOSE_DELAY_MS,
  SCROLL_QUIET_MS,
} as const;
