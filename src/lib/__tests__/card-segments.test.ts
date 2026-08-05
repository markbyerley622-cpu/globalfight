import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentCard, excludeFight, estimateBoutTimes } from "@/lib/card-segments";

// ════════════════════════════════════════════════════════════════════════════
//  excludeFight — the guarantee that a bout is never rendered twice.
//
//  The event page promotes the featured bout into a hero module of its own and
//  renders the rest of the card beneath it. Before this filter existed, the
//  featured bout was in BOTH: the reader was asked to predict the same fight
//  twice, against a single shared crowd bar, with two challenge entry points.
//
//  It is filtered at the DATA level rather than skipped inside the render loop,
//  because a broadcast block holding nothing but the main event has to disappear
//  entirely — otherwise the card shows a "Main card" heading with no bouts under
//  it.
// ════════════════════════════════════════════════════════════════════════════

// Structurally a SegmentableFight — segmentCard is generic over it, and the
// billing flags are part of that contract even though only the ORDER of the
// incoming list (set by orderFights) decides the split.
interface TestFight {
  id: string;
  scheduledRounds: number;
  mainEvent: boolean;
  coMain: boolean;
  cardSegment?: string | null;
  cancelled?: boolean;
}

const f = (id: string, over: Partial<TestFight> = {}): TestFight => ({
  id, scheduledRounds: 3, mainEvent: false, coMain: false, ...over,
});

const ids = (blocks: { fights: TestFight[] }[]) => blocks.flatMap((b) => b.fights.map((x) => x.id));

test("excludeFight removes exactly one bout and leaves the run order intact", () => {
  const { blocks } = segmentCard([f("a"), f("b"), f("c"), f("d")]);
  const before = ids(blocks);
  const after = ids(excludeFight(blocks, "a"));

  assert.equal(after.length, before.length - 1);
  assert.ok(!after.includes("a"), "the featured bout is gone");
  assert.deepEqual(after, before.filter((x) => x !== "a"), "everything else keeps its order");
});

test("excludeFight drops a block it empties rather than leaving a bald heading", () => {
  // Provider-supplied segments: the MAIN block holds only the main event.
  const { blocks } = segmentCard([
    f("main", { cardSegment: "MAIN" }),
    f("p1", { cardSegment: "PRELIM" }),
    f("p2", { cardSegment: "PRELIM" }),
  ]);
  assert.equal(blocks.length, 2);

  const after = excludeFight(blocks, "main");
  assert.equal(after.length, 1, "the now-empty MAIN block is removed, not rendered empty");
  assert.deepEqual(ids(after), ["p2", "p1"]);
  assert.ok(after.every((b) => b.fights.length > 0));
});

test("excludeFight is a no-op for a null id or an id that isn't on the card", () => {
  const { blocks } = segmentCard([f("a"), f("b")]);
  assert.deepEqual(ids(excludeFight(blocks, null)), ids(blocks));
  assert.deepEqual(ids(excludeFight(blocks, "not-on-this-card")), ids(blocks));
});

test("a one-bout card excludes to nothing — the hero was the whole card", () => {
  const { blocks } = segmentCard([f("solo")]);
  assert.deepEqual(excludeFight(blocks, "solo"), [], "no empty blocks are left behind");
});

test("excludeFight does not mutate the blocks it was given", () => {
  // The page derives walkout times from the FULL blocks and the rendered card
  // from the filtered ones. If this mutated, the schedule would lose a bout.
  const { blocks } = segmentCard([f("a"), f("b"), f("c")]);
  const before = ids(blocks);
  excludeFight(blocks, "b");
  assert.deepEqual(ids(blocks), before);
});

test("walkout times stay correct because the estimate runs BEFORE the exclusion", () => {
  // The featured bout still occupies real time in the night. Estimating on the
  // filtered blocks would slide every later bout earlier and make the whole
  // schedule wrong — so the page must estimate first, then filter.
  const fights = [f("a"), f("b"), f("c")];
  const { blocks } = segmentCard(fights);
  const eventDate = new Date("2026-08-01T22:00:00Z");

  const full = estimateBoutTimes(blocks, eventDate);
  const filteredFirst = estimateBoutTimes(excludeFight(blocks, ids(blocks)[0]), eventDate);

  const survivor = ids(blocks)[1];
  assert.notEqual(
    full.get(survivor)!.getTime(),
    filteredFirst.get(survivor)!.getTime(),
    "estimating after filtering shifts the remaining bouts — which is why the page does not",
  );
});
