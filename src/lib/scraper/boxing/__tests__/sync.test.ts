import { test } from "node:test";
import assert from "node:assert/strict";
import { syncBoxing } from "../sync";
import { isCardArticle } from "../discover";
import { CATEGORY_SOURCES } from "../config";

// Boxing was the platform's largest gap — 20 events against 573 MMA, and the
// sport's biggest names existed only as ranking stubs with zero bouts. These
// tests run the provider with the network replaced, so every guard is exercised
// against the shapes Wikipedia actually serves.

const SOURCE = CATEGORY_SOURCES[0];

/** A per-fight article: one infobox, one results table. The normal case. */
const CARD = `
  <table class="infobox">
    <tr><th>Date</th><td>13 September 2025</td></tr>
    <tr><th>Venue</th><td>Allegiant Stadium</td></tr>
    <tr><th>Location</th><td>Paradise, Nevada, United States</td></tr>
    <tr><th>Promoter</th><td>Zuffa Boxing</td></tr>
  </table>
  <table class="wikitable">
    <tr><th>Weight class</th><th></th><th></th><th></th><th>Method</th></tr>
    <tr><td>Super middleweight</td><td>Terence Crawford</td><td>def.</td><td>Canelo Álvarez (c)</td><td>UD</td></tr>
    <tr><td>Lightweight</td><td>Callum Walsh</td><td>def.</td><td>Fernando Vargas Jr</td><td>TKO</td></tr>
  </table>`;

/** Co-promoted: the promoter cell names two, so the card stays unattributed. */
const CO_PROMOTED = CARD.replace("<td>Zuffa Boxing</td>", "<td>Matchroom and Queensberry</td>");

/** No infobox date — cannot be stored on a date, must be refused. */
const NO_DATE = CARD.replace("<tr><th>Date</th><td>13 September 2025</td></tr>", "");

/** An article with an infobox but no bout rows. */
const NO_TABLE = `<table class="infobox"><tr><th>Date</th><td>1 March 2025</td></tr></table><p>Announced.</p>`;

/** A season round-up: far more bouts than any single card runs. */
const SEASON = `
  <table class="infobox"><tr><th>Date</th><td>1 March 2025</td></tr></table>
  <table class="wikitable">
    <tr><th>Weight class</th><th></th><th></th><th></th><th>Method</th></tr>
    ${Array.from({ length: 40 }, (_, i) =>
      `<tr><td>Welterweight</td><td>Fighter A${i}</td><td>def.</td><td>Fighter B${i}</td><td>UD</td></tr>`).join("")}
  </table>`;

/** Every corner unannounced — the placeholder rule must reject the whole card. */
const ALL_TBA = `
  <table class="infobox"><tr><th>Date</th><td>1 June 2026</td></tr></table>
  <table class="wikitable">
    <tr><th>Weight class</th><th></th><th></th><th></th><th>Method</th></tr>
    <tr><td>Heavyweight</td><td>TBA</td><td>vs.</td><td>Opponent TBA</td><td></td></tr>
  </table>`;

function run(members: string[], pages: Record<string, string>, extra = {}) {
  return syncBoxing({
    sources: [SOURCE],
    years: [2025],
    listCategory: async () => members,
    fetchArticle: async (t) => (pages[t] ? { title: t, html: pages[t] } : null),
    ...extra,
  });
}

// ── discovery ─────────────────────────────────────────────────────────────

test("tournaments and round-ups are refused BEFORE a request is spent", () => {
  // Each of these is a real member of Category:2025 in boxing.
  for (const t of [
    "Boxing at the 2025 SEA Games",
    "Boxing at the 2025 Islamic Solidarity Games",
    "2025 World Boxing Championships",
    "2025 IBA Men's World Boxing Championships",
    "2025 World Boxing Cup",
    "2025 in Misfits Boxing",
    "List of influencer boxing matches",
  ]) {
    assert.equal(isCardArticle(t), false, `should be refused: ${t}`);
  }
});

test("real per-fight articles are accepted", () => {
  for (const t of [
    "Canelo Álvarez vs. Terence Crawford",
    "Oleksandr Usyk vs. Daniel Dubois II",
    "Artur Beterbiev vs. Dmitry Bivol II",
    "Chris Eubank Jr vs Conor Benn",
    "Ryan Garcia vs. Rolando Romero",
    "Manny Pacquiao vs. Mario Barrios",
  ]) {
    assert.equal(isCardArticle(t), true, `should be accepted: ${t}`);
  }
});

// ── the happy path ────────────────────────────────────────────────────────

test("a card article becomes an event with its bouts, date and venue", async () => {
  const { events, report } = await run(["Canelo Álvarez vs. Terence Crawford"], {
    "Canelo Álvarez vs. Terence Crawford": CARD,
  });

  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.name, "Canelo Álvarez vs. Terence Crawford");
  assert.equal(e.sport, "BOXING");
  assert.equal(e.venue, "Allegiant Stadium");
  assert.equal(e.city, "Paradise");
  assert.equal(e.country, "United States");
  assert.equal(e.date?.slice(0, 10), "2025-09-13");
  assert.equal(e.promotion, "Zuffa Boxing");
  assert.equal(e.fights?.length, 2);
  assert.equal(report.bouts, 2);
  // Provenance: keyed on the article so a rerun updates rather than duplicates.
  assert.equal(e.externalId, "wp-cat:Canelo Álvarez vs. Terence Crawford");
  assert.equal(e._meta.source, "wikipedia-category");
});

test("a past card is COMPLETED and a future one is SCHEDULED", async () => {
  const past = await run(["A vs B"], { "A vs B": CARD });
  assert.equal(past.events[0].status, "COMPLETED");

  const futureCard = CARD.replace("13 September 2025", "13 September 2099");
  const future = await run(["C vs D"], { "C vs D": futureCard });
  assert.equal(future.events[0].status, "SCHEDULED");
});

// ── the guards ────────────────────────────────────────────────────────────

test("a co-promoted card is left UNATTRIBUTED rather than crediting one promoter", async () => {
  const { events } = await run(["X vs Y"], { "X vs Y": CO_PROMOTED });
  assert.equal(events[0].promotion, undefined);
});

test("no date in the infobox is refused, with the reason recorded", async () => {
  const { events, report } = await run(["X vs Y"], { "X vs Y": NO_DATE });
  assert.equal(events.length, 0);
  assert.equal(report.unusable[0].why, "no date in the infobox");
});

test("an announced card with no results table is refused", async () => {
  const { events, report } = await run(["X vs Y"], { "X vs Y": NO_TABLE });
  assert.equal(events.length, 0);
  assert.equal(report.unusable[0].why, "no results table");
});

test("a season page cannot attach 40 bouts to one card", async () => {
  // The over-attach the promotion-index path was bitten by: it is silent, and
  // every card looks populated.
  //
  // Titled like a real fight on purpose — a round-up caught by the title rule
  // would never reach this guard, and the guard is the thing under test.
  const { events, report } = await run(["Big Card vs Bigger Card"], { "Big Card vs Bigger Card": SEASON });
  assert.equal(events.length, 0);
  assert.deepEqual(
    report.unusable.map((u) => u.why),
    ["implausible bout count - looks like a season page"],
  );
});

test("the title rule and the bout-count guard are SEPARATE defences", async () => {
  // A round-up is refused by name before a request; the guard above catches one
  // that slips through under an innocent title. Both must hold independently.
  const { report } = await run(["2025 in Misfits Boxing"], { "2025 in Misfits Boxing": SEASON });
  assert.deepEqual(report.unusable.map((u) => u.why), ["not a single card"]);
  assert.equal(report.cardsFetched, 0, "must not have spent a request");
});

test("a card of only unannounced corners produces no event", async () => {
  const { events, report } = await run(["X vs Y"], { "X vs Y": ALL_TBA });
  assert.equal(events.length, 0);
  assert.equal(report.unusable[0].why, "every bout has an unnamed corner");
});

test("a missing article is reported, not thrown", async () => {
  const { events, report } = await run(["Ghost vs Nobody"], {});
  assert.equal(events.length, 0);
  assert.equal(report.unusable[0].why, "article not found");
});

// ── resumability + idempotence ────────────────────────────────────────────

test("already-ingested articles are skipped WITHOUT a request", async () => {
  let fetched = 0;
  const { events, report } = await syncBoxing({
    sources: [SOURCE],
    years: [2025],
    listCategory: async () => ["A vs B"],
    fetchArticle: async (t) => { fetched++; return { title: t, html: CARD }; },
    skipArticles: new Set(["A vs B"]),
  });
  assert.equal(fetched, 0);
  assert.equal(events.length, 0);
  assert.equal(report.cardsSkipped, 1);
});

test("maxCards bounds a run so a long backfill is resumable", async () => {
  const members = Array.from({ length: 10 }, (_, i) => `A${i} vs B${i}`);
  const pages = Object.fromEntries(members.map((m) => [m, CARD]));
  const { events, report } = await run(members, pages, { maxCards: 3 });
  assert.equal(events.length, 3);
  assert.equal(report.cardsFetched, 3);
});

test("one article in two years' categories is fetched ONCE", async () => {
  let fetched = 0;
  const { events } = await syncBoxing({
    sources: [SOURCE],
    years: [2025, 2026],
    listCategory: async () => ["A vs B"],
    fetchArticle: async (t) => { fetched++; return { title: t, html: CARD }; },
  });
  assert.equal(fetched, 1);
  assert.equal(events.length, 1);
});

test("a category that does not exist is not an error", async () => {
  const { events, report } = await run([], {});
  assert.equal(events.length, 0);
  assert.equal(report.warnings.length, 0);
  assert.equal(report.categoriesRead, 1);
});
