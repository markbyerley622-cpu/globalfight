// Article → event matching. Pure — no database, no network.
//
// The contract under test is one-sided on purpose: a SKIPPED article costs an
// event staying empty for another day; a WRONG match writes nine bouts onto
// somebody else's card and every one of them then looks like real data.
//
//   npm test

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { eventNamesFromTitle, matchArticleToEvent, type EventCandidate } from "../match";

const at = (iso: string) => new Date(`${iso}T00:00:00Z`);

const event = (name: string, date = "2026-07-31"): EventCandidate => ({
  id: `id-${name.toLowerCase().replace(/\W+/g, "-")}`,
  name,
  date: at(date),
});

describe("recovering the event name", () => {
  it("strips the editorial suffix ONE appends to every results article", () => {
    assert.deepEqual(
      eventNamesFromTitle("ONE Fight Night 45 – Results And Highlights For Every Match"),
      ["ONE Fight Night 45"],
    );
  });

  it("drops the headline matchup after the card name", () => {
    // Real title from the captured page. The registry stores the CARD name; the
    // headline bout is not part of it.
    assert.deepEqual(
      eventNamesFromTitle("ONE Fight Night 45 Lessei Vs Rabah – Results And Highlights For Every Match"),
      ["ONE Fight Night 45"],
    );
    assert.deepEqual(
      eventNamesFromTitle("ONE Fight Night 44: Jarvis vs. Rungrawee II – Results And Highlights For Every Match"),
      ["ONE Fight Night 44"],
    );
  });

  it("returns BOTH cards when one article covers two", () => {
    // ONE genuinely runs two cards on one night and writes them up together.
    // Both may be in the registry, so this yields a list rather than a guess.
    assert.deepEqual(
      eventNamesFromTitle("The Inner Circle 24 And ONE Friday Fights 164 – Results And Highlights For Every Match"),
      ["The Inner Circle 24", "ONE Friday Fights 164"],
    );
  });

  it("returns nothing usable for an unrelated headline", () => {
    assert.deepEqual(eventNamesFromTitle(""), []);
    assert.deepEqual(eventNamesFromTitle("   "), []);
  });
});

describe("matching", () => {
  const registry = [
    event("ONE Fight Night 45"),
    event("ONE Fight Night 44", "2026-06-20"),
    event("ONE Friday Fights 164"),
    event("The Inner Circle 24"),
  ];

  it("matches on the canonical title", () => {
    const r = matchArticleToEvent("ONE Fight Night 45 Lessei Vs Rabah – Results And Highlights For Every Match", registry);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.eventId, "id-one-fight-night-45");
      assert.equal(r.via, "canonical_title");
    }
  });

  it("matches either card of a double-header article", () => {
    // Only one of the two is in this registry, so there is exactly one hit and
    // the answer is unambiguous.
    const r = matchArticleToEvent(
      "The Inner Circle 99 And ONE Friday Fights 164 – Results And Highlights For Every Match",
      [event("ONE Friday Fights 164")],
    );
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.matchedName, "ONE Friday Fights 164");
  });

  it("SKIPS when nothing matches", () => {
    const r = matchArticleToEvent("ONE Fight Night 999 – Results And Highlights For Every Match", registry);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "no_match");
  });

  it("SKIPS rather than choosing between two equally good candidates", () => {
    // The exact case a similarity score would resolve by guessing. Two events
    // with the same canonical name is a data problem to be reviewed, not a
    // coin to be flipped.
    const twins = [
      { id: "a", name: "ONE Fight Night 45", date: at("2026-07-31") },
      { id: "b", name: "ONE Fight Night 45", date: at("2026-07-30") },
    ];
    const r = matchArticleToEvent("ONE Fight Night 45 – Results And Highlights For Every Match", twins);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "ambiguous");
  });

  it("never matches on a partial or fuzzy name", () => {
    // "ONE Fight Night 4" must not match "ONE Fight Night 45". A prefix rule or
    // an edit-distance threshold would, and would attach a whole card to the
    // wrong event.
    const r = matchArticleToEvent("ONE Fight Night 4 – Results And Highlights For Every Match", registry);
    assert.equal(r.ok, false);
  });

  it("does not confuse Friday Fights with Fight Night", () => {
    const r = matchArticleToEvent("ONE Friday Fights 45 – Results And Highlights For Every Match", registry);
    assert.equal(r.ok, false);
  });

  it("reports the names it tried, so a skip is reviewable", () => {
    const r = matchArticleToEvent("ONE Fight Night 999 – Results And Highlights For Every Match", registry);
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual(r.names, ["ONE Fight Night 999"]);
  });
});

describe("date corroboration", () => {
  const registry = [event("ONE Fight Night 45", "2026-07-31")];
  const title = "ONE Fight Night 45 – Results And Highlights For Every Match";

  it("accepts a match inside the window", () => {
    assert.equal(matchArticleToEvent(title, registry, { articleDate: at("2026-08-02") }).ok, true);
  });

  it("refuses a name match that is a year away", () => {
    // The annual-rerun case: the same card name in a different year is a
    // different event, and the name alone cannot tell them apart.
    const r = matchArticleToEvent(title, registry, { articleDate: at("2025-07-31") });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "no_match");
  });

  it("matches on name alone when the article carried no date", () => {
    // The listing publishes "Jul 31" with no year, so a date is often absent.
    // Absence must not block a match — it simply cannot corroborate one.
    assert.equal(matchArticleToEvent(title, registry, { articleDate: null }).ok, true);
  });
});

describe("the guarantee", () => {
  it("never returns ok without an eventId", () => {
    const cases: [string, EventCandidate[]][] = [
      ["ONE Fight Night 45 – Results And Highlights For Every Match", [event("ONE Fight Night 45")]],
      ["nonsense", []],
      ["", [event("ONE Fight Night 45")]],
      ["ONE Fight Night 45 – Results And Highlights For Every Match", []],
    ];
    for (const [title, registry] of cases) {
      const r = matchArticleToEvent(title, registry);
      if (r.ok) assert.ok(r.eventId, `ok verdict with no eventId for "${title}"`);
    }
  });

  it("never throws on malformed input", () => {
    for (const title of ["", "   ", "–", "A".repeat(400)]) {
      assert.doesNotThrow(() => matchArticleToEvent(title, [event("ONE Fight Night 45")]));
    }
  });
});
