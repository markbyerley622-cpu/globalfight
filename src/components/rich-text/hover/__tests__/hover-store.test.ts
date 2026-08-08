import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  requestOpen, requestClose, holdOpen, closeNow, noteScroll,
  isScrollQuiet, getOpen, getServerOpen, subscribe, HOVER_TIMING,
} from "../store";
import type { RichEntity } from "@/lib/rich-text/types";

// ════════════════════════════════════════════════════════════════════════════
//  THE INTERACTION CONTRACT.
//
//  Hover timing is the part of a preview system that is impossible to eyeball:
//  every value looks fine in isolation, and the bugs are all about ORDER —
//  a card that opens after the pointer has left, a scroll that opens a card
//  nobody asked for, a second card opening on top of the first. Those are the
//  cases here.
// ════════════════════════════════════════════════════════════════════════════

/** Anchors are compared by identity, so plain objects stand in for elements. */
const anchor = (name: string) => ({ name }) as unknown as HTMLElement;

const entity: RichEntity = {
  type: "mention", id: "u1", start: 0, end: 5, hint: { username: "alex" },
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Long enough for the open delay to have fired, with room for timer jitter. */
const AFTER_OPEN = HOVER_TIMING.OPEN_DELAY_MS + 60;
const AFTER_CLOSE = HOVER_TIMING.CLOSE_DELAY_MS + 60;

beforeEach(() => {
  closeNow();
});

describe("the open delay", () => {
  test("a pointer passing over a chip opens NOTHING", async () => {
    // The whole reason for the delay: crossing a sentence full of mentions on
    // the way to something else must not fire a card per word.
    requestOpen({ entity, anchor: anchor("a"), via: "pointer" });
    await wait(HOVER_TIMING.OPEN_DELAY_MS - 80);
    assert.equal(getOpen(), null, "the card opened before the delay elapsed");

    requestClose();
    await wait(AFTER_OPEN);
    assert.equal(getOpen(), null, "a withdrawn hover still opened");
  });

  test("a deliberate hover opens after the delay", async () => {
    requestOpen({ entity, anchor: anchor("a"), via: "pointer" });
    await wait(AFTER_OPEN);
    assert.ok(getOpen(), "a sustained hover never opened");
  });

  test("the delay sits in the 150–250ms band the design calls for", () => {
    // Pinned because it is a product decision, not a tuning knob: below ~150ms
    // a card opens while the pointer is still travelling, above ~250ms a
    // deliberate hover feels like waiting.
    assert.ok(
      HOVER_TIMING.OPEN_DELAY_MS >= 150 && HOVER_TIMING.OPEN_DELAY_MS <= 250,
      `open delay is ${HOVER_TIMING.OPEN_DELAY_MS}ms, outside the 150–250ms band`,
    );
  });

  test("keyboard focus opens IMMEDIATELY — a delay on a keyboard is latency", () => {
    requestOpen({ entity, anchor: anchor("a"), via: "keyboard" });
    assert.ok(getOpen(), "focus did not open the card synchronously");
    assert.equal(getOpen()?.via, "keyboard");
  });

  test("a long press opens immediately — the gesture already proved intent", () => {
    requestOpen({ entity, anchor: anchor("a"), via: "touch" });
    assert.ok(getOpen());
  });
});

describe("closing", () => {
  test("a pending open is cancelled at once — nothing is on screen to be gentle about", async () => {
    requestOpen({ entity, anchor: anchor("a"), via: "pointer" });
    requestClose();
    await wait(AFTER_OPEN);
    assert.equal(getOpen(), null);
  });

  test("an OPEN card gets a grace period, so the pointer can reach it", async () => {
    requestOpen({ entity, anchor: anchor("a"), via: "keyboard" });
    requestClose();

    // Still open immediately after leaving the chip — this gap is the pixels
    // between the chip and the card.
    assert.ok(getOpen(), "the card vanished the instant the pointer left the chip");

    await wait(AFTER_CLOSE);
    assert.equal(getOpen(), null, "the card never closed");
  });

  test("reaching the card cancels the dismissal", async () => {
    requestOpen({ entity, anchor: anchor("a"), via: "keyboard" });
    requestClose();
    holdOpen();

    await wait(AFTER_CLOSE);
    assert.ok(getOpen(), "the card closed even though the pointer was on it");
  });

  test("closeNow is immediate — Escape must not wait out a grace period", () => {
    requestOpen({ entity, anchor: anchor("a"), via: "keyboard" });
    closeNow();
    assert.equal(getOpen(), null);
  });

  test("the close grace is shorter than the open delay", () => {
    // Otherwise a card lingers over content the reader has already moved past
    // for longer than it took to earn its place.
    assert.ok(HOVER_TIMING.CLOSE_DELAY_MS < HOVER_TIMING.OPEN_DELAY_MS);
  });
});

describe("only one card exists", () => {
  test("moving to another chip SWAPS rather than stacking", async () => {
    const first = anchor("a");
    requestOpen({ entity, anchor: first, via: "keyboard" });
    assert.equal(getOpen()?.anchor, first);

    const second = anchor("b");
    requestOpen({ entity, anchor: second, via: "pointer" });

    // Swapped SYNCHRONOUSLY: with a card already open the reader has already
    // waited once, and making them wait again to compare two people is what
    // makes hover UI feel sticky.
    assert.equal(getOpen()?.anchor, second, "the second chip did not take over");
  });

  test("re-entering the SAME chip does not restart anything", async () => {
    const a = anchor("a");
    requestOpen({ entity, anchor: a, via: "keyboard" });
    requestOpen({ entity, anchor: a, via: "pointer" });
    assert.equal(getOpen()?.anchor, a);
    assert.equal(getOpen()?.via, "keyboard", "the original open reason was overwritten");
  });
});

describe("scrolling suppresses previews", () => {
  test("a scroll abandons a pending open", async () => {
    requestOpen({ entity, anchor: anchor("a"), via: "pointer" });
    noteScroll();
    await wait(AFTER_OPEN);

    // Flicking a feed drags the pointer across whatever passes under it. A card
    // for whichever chip happened to land under a stationary finger is a
    // preview nobody asked for, mid-gesture.
    assert.equal(getOpen(), null, "a card opened during a scroll");
  });

  test("a hover started DURING the quiet window opens nothing", async () => {
    noteScroll();
    assert.equal(isScrollQuiet(), true);
    requestOpen({ entity, anchor: anchor("a"), via: "pointer" });
    await wait(AFTER_OPEN);
    assert.equal(getOpen(), null);
  });

  test("the window expires, so previews come back once scrolling stops", async () => {
    noteScroll();
    await wait(HOVER_TIMING.SCROLL_QUIET_MS + 40);
    assert.equal(isScrollQuiet(), false);

    requestOpen({ entity, anchor: anchor("a"), via: "pointer" });
    await wait(AFTER_OPEN);
    assert.ok(getOpen(), "previews never recovered after a scroll");
  });

  test("an ALREADY-OPEN card survives a scroll", () => {
    requestOpen({ entity, anchor: anchor("a"), via: "keyboard" });
    noteScroll();
    // The reader opened this deliberately; scrolling the page under it is not
    // a request to dismiss it. The host re-anchors it instead.
    assert.ok(getOpen(), "scrolling closed a card the reader had opened");
  });
});

describe("subscription", () => {
  test("subscribers are notified on open and on close", () => {
    let ticks = 0;
    const unsub = subscribe(() => { ticks += 1; });

    requestOpen({ entity, anchor: anchor("a"), via: "keyboard" });
    assert.equal(ticks, 1);
    closeNow();
    assert.equal(ticks, 2);

    unsub();
    requestOpen({ entity, anchor: anchor("b"), via: "keyboard" });
    assert.equal(ticks, 2, "an unsubscribed listener was still called");
  });

  test("the server snapshot is a STABLE null", () => {
    // useSyncExternalStore compares snapshots by identity and loops forever if
    // the server snapshot is a fresh value each call.
    assert.equal(getServerOpen(), getServerOpen());
    assert.equal(getServerOpen(), null);
  });
});
