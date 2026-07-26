import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeLabel, shapeIndex } from "../video-shape";

// Video ordering on an event page is phase-dependent: after the bell a fan wants
// the knockout, not last week's Embedded vlog. This is deterministic — the shape
// is read from the real title, never invented.

test("shapeLabel reads the editorial shape from the title", () => {
  assert.equal(shapeLabel("Tyson Fury vs Mariusz Wach HIGHLIGHTS"), "Highlights");
  assert.equal(shapeLabel("Fury post-fight interview"), "Interview");
  assert.equal(shapeLabel("UFC 300 Embedded: fight week vlog"), "Fight week");
  assert.equal(shapeLabel("Ceremonial weigh-in"), "Weigh-ins");
  assert.equal(shapeLabel("A normal news clip"), null);
});

test("POST phase: highlights and recap lead, fight-week build-up sinks", () => {
  const hl = shapeIndex("Fury vs Wach HIGHLIGHTS", "post");
  const recap = shapeIndex("Fury vs Wach full results and recap", "post");
  const embedded = shapeIndex("Fury Embedded: fight week vlog", "post");
  const weighin = shapeIndex("Fury vs Wach weigh-in", "post");
  assert.ok(hl < embedded, "highlights beat fight-week after the fight");
  assert.ok(recap < embedded, "recap beats fight-week after the fight");
  assert.ok(hl < weighin && recap < weighin);
});

test("PRE phase: the ordering flips — build-up leads, highlights sink", () => {
  const hl = shapeIndex("Fury vs Wach HIGHLIGHTS", "pre");
  const embedded = shapeIndex("Fury Embedded: fight week vlog", "pre");
  const interview = shapeIndex("Fury sits down for an interview", "pre");
  assert.ok(embedded < hl, "before the fight, fight-week build-up beats (stale) highlights");
  assert.ok(interview < hl);
});

test("a title with no known shape ranks last, not first, in either phase", () => {
  const unknown = shapeIndex("Some random clip", "post");
  const hl = shapeIndex("KO highlights", "post");
  assert.ok(hl < unknown);
});
