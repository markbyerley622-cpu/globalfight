import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { syncYearPages, eventMatchKey, YEAR_SOURCE } from "../year-sync";
import type { YearPageSource } from "../config";

// NO NETWORK: the page fetcher is injected.
//
// The decision under test is fill-vs-create. persistAggregated identifies an
// event by slugify(name), so emitting the upstream name for a card we already
// hold creates a SECOND event beside the empty one — silently, with both copies
// looking populated. That is a worse outcome than the empty card it was meant to
// fix, and it is the reason resolveStored exists.

const fixture = (n: string) =>
  fs.readFileSync(path.join(import.meta.dirname, "fixtures", `${n}.html`), "utf8");

const ONE: YearPageSource = {
  key: "one",
  titleTemplate: "{year} in ONE Championship",
  promotion: "ONE Championship",
  sport: "MMA",
  firstYear: 2011,
  sourceLadder: "test",
};

const serve = (pages: Record<string, string>) => async (title: string) =>
  pages[title] ? { title, html: pages[title] } : null;

const PAGES = { "2026 in ONE Championship": fixture("one-2026") };

// ── the matching key ────────────────────────────────────────────────────────

test("the two sides' names reduce to the same designation", () => {
  // Ours is named for the billing, theirs for the headline. Neither is wrong;
  // they just cannot be compared until both are reduced.
  assert.equal(
    eventMatchKey("ONE Friday Fights 164 & The Inner Circle 24"),
    eventMatchKey("ONE Friday Fights 164: Pompet vs. Nat Khat Min / The Inner Circle 23"),
  );
  assert.equal(eventMatchKey("ONE Friday Fights 164 & The Inner Circle 24"), "one friday fights 164");
});

test("different cards do NOT collapse onto one key", () => {
  const keys = [
    "ONE Friday Fights 164 & The Inner Circle 24",
    "ONE Friday Fights 165 & The Inner Circle 25",
    "ONE Fight Night 45: Lessei vs. Rabah",
    "ONE SAMURAI 2",
  ].map(eventMatchKey);
  assert.equal(new Set(keys).size, keys.length, "two cards share a match key");
});

test("a headline-only name keeps its headline — cutting at the colon would collapse it", () => {
  // ONE ran No Surrender 2 AND 3 on 2020-07-31. Cutting at the colon leaves
  // "ONE Championship" for both, and the second card's bouts would be written
  // onto the first card's row, under the first card's name.
  const a = eventMatchKey("ONE Championship: No Surrender 2");
  const b = eventMatchKey("ONE Championship: No Surrender 3");
  assert.notEqual(a, b);
  assert.equal(a, "one championship: no surrender 2");

  // Same shape, same night, four cards — none may share a key.
  const matrix = [2, 3, 4].map((n) => eventMatchKey(`ONE Championship: Inside the Matrix ${n}`));
  assert.equal(new Set(matrix).size, 3);
});

test("a numbered designation still collapses to the number, which is the point", () => {
  // Here the head DOES carry the card number, so the headline is noise and the
  // two sides' different headlines must not prevent a match.
  assert.equal(
    eventMatchKey("ONE 168: Denver"),
    eventMatchKey("ONE 168: Haggerty vs. Superlek"),
  );
  assert.equal(
    eventMatchKey("ONE Fight Night 21: Eersel vs. Nicholas"),
    eventMatchKey("ONE Fight Night 21: Eersel vs. Nicolas on Prime Video"),
  );
});

// ── fill vs create ──────────────────────────────────────────────────────────

test("a card we already hold is emitted under OUR name, so it fills instead of duplicating", async () => {
  const stored = "ONE Friday Fights 138 & The Inner Circle 1";
  const { events, report } = await syncYearPages({
    sources: [ONE],
    years: [2026],
    fetchArticle: serve(PAGES),
    resolveStored: (k) => (k.name.startsWith("ONE Friday Fights 138") ? stored : null),
  });

  const filled = events.find((e) => e.name === stored);
  assert.ok(filled, "emitted under the upstream name — this would create a duplicate");
  assert.ok((filled.fights ?? []).length > 0);
  assert.equal(report.matchedExisting, 1);
  assert.equal(report.newCards, events.length - 1);
});

test("a card we do NOT hold keeps the upstream name", async () => {
  const { events } = await syncYearPages({
    sources: [ONE], years: [2026], fetchArticle: serve(PAGES), resolveStored: () => null,
  });
  assert.ok(events.length > 0);
  assert.ok(events.every((e) => e.name.startsWith("ONE")));
  assert.ok(events.some((e) => e.name.includes("ONE Friday Fights 138")));
});

test("with no resolver every card is reported as new — it never silently assumes a match", async () => {
  const { report } = await syncYearPages({ sources: [ONE], years: [2026], fetchArticle: serve(PAGES) });
  assert.equal(report.matchedExisting, 0);
  assert.equal(report.newCards, report.sections);
});

// ── provenance and shape ────────────────────────────────────────────────────

test("each card gets its OWN external id, so two cards off one page never collide", async () => {
  const { events } = await syncYearPages({ sources: [ONE], years: [2026], fetchArticle: serve(PAGES) });
  const ids = events.map((e) => e.externalId);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.startsWith("wp-year:one:")));
  assert.ok(events.every((e) => e._meta.source === YEAR_SOURCE));
});

test("bouts are attributed per card, not pooled across the season", async () => {
  const { events, report } = await syncYearPages({ sources: [ONE], years: [2026], fetchArticle: serve(PAGES) });
  assert.equal(events.length, 6);
  assert.equal(report.bouts, events.reduce((n, e) => n + (e.fights?.length ?? 0), 0));
  // The over-attach failure: no card may carry the whole page's bouts.
  assert.ok(events.every((e) => (e.fights?.length ?? 0) < report.bouts));
});

// ── refusals ────────────────────────────────────────────────────────────────

test("a year with no round-up is counted as absent, not as a failure", async () => {
  const { events, report } = await syncYearPages({
    sources: [ONE], years: [2015, 2026], fetchArticle: serve(PAGES),
  });
  assert.equal(report.pagesMissing, 1);
  assert.equal(report.pagesFetched, 1);
  assert.equal(report.warnings.length, 0, "an absent page is a source fact, not a warning");
  assert.ok(events.length > 0);
});

test("years before the promotion existed are never requested", async () => {
  let asked = 0;
  await syncYearPages({
    sources: [ONE],
    years: [2005, 2008],
    fetchArticle: async (t) => { asked += 1; return serve(PAGES)(t); },
  });
  assert.equal(asked, 0);
});

test("a fetch that throws is recorded and does not abort the run", async () => {
  const { events, report } = await syncYearPages({
    sources: [ONE],
    years: [2025, 2026],
    fetchArticle: async (t) => {
      if (t.startsWith("2025")) throw new Error("upstream 503");
      return serve(PAGES)(t);
    },
  });
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /503/);
  assert.ok(events.length > 0, "one bad year killed the whole run");
});
