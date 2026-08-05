import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isRenderableEvent, eventSkipReason, filterRenderableEvents, isAwaitingCard,
} from "@/lib/events/renderable";

const NOW = new Date("2026-08-05T12:00:00Z");
const future = "2026-12-12T00:00:00.000Z";
const past = "2026-01-12T00:00:00.000Z";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ev = (over: Record<string, unknown> = {}): any => ({
  name: "UFC 322", promotion: "UFC", sport: "MMA", date: future, fights: [{ id: "f1" }], ...over,
});

test("a normal upcoming card renders", () => {
  assert.equal(isRenderableEvent(ev(), NOW), true);
});

test("a past card WITH bouts renders", () => {
  assert.equal(isRenderableEvent(ev({ date: past }), NOW), true);
});

// The regression this whole module exists to prevent.
test("an ANNOUNCED upcoming card with no bouts yet still renders", () => {
  const one = ev({ name: "ONE Fight Night 50", promotion: "ONE Championship", fights: [] });
  assert.equal(eventSkipReason(one, NOW), null,
    "an announced card whose bouts are not published yet is not an empty card");
});

test("a FINISHED card with no bouts is hidden", () => {
  const dead = ev({ name: "ONE Friday Fights 139", promotion: "ONE Championship", date: past, fights: [] });
  assert.equal(eventSkipReason(dead, NOW), "PAST_WITH_NO_BOUTS");
});

test("a sport-and-date shell is hidden regardless of date", () => {
  for (const name of ["Boxing — 2 August", "Boxing - 2 August 2026", "MMA – 14 Sep", "kickboxing — 3 May 2026"]) {
    assert.equal(eventSkipReason(ev({ name, promotion: undefined, fights: [] }), NOW), "SPORT_DATE_SHELL", name);
  }
  // Even with bouts and a future date — the name still tells a reader nothing.
  assert.equal(eventSkipReason(ev({ name: "Boxing — 2 August" }), NOW), "SPORT_DATE_SHELL");
});

test("a real name that merely STARTS with a sport word is kept", () => {
  // Guards the shell regex against eating legitimate cards.
  for (const name of ["Boxing Day Brawl", "MMA Masters 7", "Muay Thai Grand Prix", "Wrestling Observer Live"]) {
    assert.equal(eventSkipReason(ev({ name }), NOW), null, name);
  }
});

test("no promotion AND no bouts is hidden", () => {
  assert.equal(eventSkipReason(ev({ promotion: undefined, fights: [] }), NOW), "NO_PROMOTION_NO_BOUTS");
});

test("no promotion but real bouts is kept — the bouts carry it", () => {
  assert.equal(eventSkipReason(ev({ promotion: undefined }), NOW), null);
});

test("blank name and unusable date are rejected", () => {
  assert.equal(eventSkipReason(ev({ name: "" }), NOW), "NO_NAME");
  assert.equal(eventSkipReason(ev({ name: "   " }), NOW), "NO_NAME");
  assert.equal(eventSkipReason(ev({ date: "not-a-date" }), NOW), "NO_DATE");
});

test("filterRenderableEvents reports what it dropped and why", () => {
  const { events, skipped } = filterRenderableEvents(
    [ev(), ev({ name: "Boxing — 2 August" }), ev({ date: past, fights: [] })],
    NOW,
  );
  assert.equal(events.length, 1);
  assert.deepEqual(skipped.map((s) => s.reason).sort(), ["PAST_WITH_NO_BOUTS", "SPORT_DATE_SHELL"]);
  assert.equal(skipped.find((s) => s.reason === "SPORT_DATE_SHELL")?.name, "Boxing — 2 August",
    "the skip record must name the event, or the log cannot be acted on");
});

test("isAwaitingCard marks upcoming-without-bouts for labelling, not hiding", () => {
  assert.equal(isAwaitingCard(ev({ fights: [] }), NOW), true);
  assert.equal(isAwaitingCard(ev(), NOW), false);
  assert.equal(isAwaitingCard(ev({ date: past, fights: [] }), NOW), false);
});
