// What the landing page's hero does when the data is thin, wrong or absent.
//
// This is the half of the page most likely to be wrong in production and least
// likely to be seen in development, because a developer's database always has
// events in it. Three failure modes are pinned here:
//
//   · the featured card disappears (it happened, it was cancelled, ingest moved it)
//   · a card exists but has no headline bout yet
//   · the database is empty or unreachable entirely
//
// In none of them may the page invent a fight.

import { test } from "node:test";
import assert from "node:assert/strict";

import { pickHero, crowdSplit, FALLBACK_HERO } from "@/components/home-landing/hero-fallback";

const withMain = (id: string, red = "A Fighter", blue = "B Fighter") => ({ id, mainEvent: { red, blue } });
const bare = (id: string) => ({ id, mainEvent: null });

test("the hero prefers the first card with two named corners", () => {
  const events = [bare("e1"), withMain("e2"), withMain("e3")];
  assert.equal(pickHero(events)?.id, "e2");
});

test("a card with a half-populated headline bout is skipped for a complete one", () => {
  const events = [withMain("e1", "A Fighter", ""), withMain("e2")];
  assert.equal(pickHero(events)?.id, "e2", "an unnamed corner must not headline the page");
});

test("a card with no headline bout is still better than nothing", () => {
  assert.equal(pickHero([bare("e1")])?.id, "e1");
  assert.equal(pickHero([withMain("e1", "", "")])?.id, "e1");
});

test("selection is positional, never by id — the next card simply takes over", () => {
  // Removing the chosen event must promote its successor with no other change.
  const events = [withMain("e1"), withMain("e2"), withMain("e3")];
  assert.equal(pickHero(events)?.id, "e1");
  assert.equal(pickHero(events.slice(1))?.id, "e2");
  assert.equal(pickHero(events.slice(2))?.id, "e3");
});

test("an empty calendar yields no hero, and the caller falls back", () => {
  assert.equal(pickHero([]), null);
});

test("the fallback card claims nothing that could be false", () => {
  assert.equal(FALLBACK_HERO.placeholder, true, "it must announce itself as a placeholder");
  assert.equal(FALLBACK_HERO.slug, null, "a placeholder must not link to an event page");
  assert.equal(FALLBACK_HERO.venue, null);
  assert.equal(FALLBACK_HERO.location, null);
  assert.equal(FALLBACK_HERO.broadcaster, null);
  assert.equal(FALLBACK_HERO.crowd, null, "no invented crowd split");
  assert.equal(FALLBACK_HERO.boutCount, 0, "no invented bout count");
  assert.equal(FALLBACK_HERO.titleFight, false, "never claim a title is on the line");
  assert.equal(FALLBACK_HERO.red.record, "", "no invented records");
  assert.equal(FALLBACK_HERO.blue.record, "");
  assert.equal(FALLBACK_HERO.red.rank, null, "no invented rankings");
  // The date is the epoch and is never rendered — the component branches on
  // `placeholder` before it reaches any date. Pinned so a refactor that starts
  // rendering it fails here rather than shipping "1 Jan 1970" to production.
  assert.equal(FALLBACK_HERO.date, new Date(0).toISOString());
});

test("the fallback names no real person, promotion or venue", () => {
  const text = JSON.stringify(FALLBACK_HERO).toLowerCase();
  for (const brand of ["ufc", "one championship", "bellator", "pfl", "bkfc", "glory", "matchroom"]) {
    assert.ok(!text.includes(brand), `the placeholder must not imply a card from ${brand}`);
  }
  assert.equal(FALLBACK_HERO.red.name, "Red corner");
  assert.equal(FALLBACK_HERO.blue.name, "Blue corner");
});

test("a crowd split with no votes is null, not a fabricated 50/50", () => {
  assert.equal(crowdSplit(null), null);
  assert.equal(crowdSplit(undefined), null);
  assert.equal(crowdSplit({ red: 0, total: 0 }), null);
});

test("a crowd split always totals exactly 100", () => {
  for (const [red, total] of [[1, 3], [2, 3], [1, 7], [5, 6], [33, 100], [1, 1], [0, 4]]) {
    const s = crowdSplit({ red, total })!;
    assert.equal(s.red + s.blue, 100, `${red}/${total} produced ${s.red}+${s.blue}`);
    assert.ok(s.red >= 0 && s.red <= 100);
    assert.equal(s.total, total, "the raw count is carried through so the number can be judged");
  }
});
