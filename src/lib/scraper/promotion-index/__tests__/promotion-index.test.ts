// Promotion event-index tests, over REAL captured Wikipedia HTML.
//
//   npm run test:promotion-index
//
// No network: the index parse runs on the fixture, and the two over-attach
// guards are exercised through a stubbed page fetcher.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseEventIndex } from "../parse";
import { MAX_CARD_BOUTS, syncPromotionIndex } from "../sync";
import { PROMOTION_INDEX_SOURCES, indexSourceFor } from "../config";
import { parseWikiCard } from "../../wikicard/extract";

const here = dirname(fileURLToPath(import.meta.url));
const INDEX = readFileSync(join(here, "fixtures", "misfits-index.html"), "utf8");

describe("event index parsing (Misfits Boxing)", () => {
  const rows = parseEventIndex(INDEX);

  it("reads the numbered card index", () => {
    assert.ok(rows.length >= 30, `expected the full index, got ${rows.length}`);
    const first = rows.find((r) => r.name === "MF & DAZN: X Series 001");
    assert.ok(first, "X Series 001 missing");
    assert.equal(first.date?.slice(0, 10), "2022-08-27");
    assert.equal(first.city, "London");
    assert.equal(first.country, "England");
    assert.equal(first.venue, "The O2 Arena");
  });

  it("matches columns by HEADER NAME, not position", () => {
    // The upcoming-events table on the same page carries an extra "Titles(s)"
    // column. Fixed indexing reads the date out of the titles cell and every
    // upcoming card silently loses its date.
    const upcoming = rows.find((r) => /Conlan vs\. Walsh/i.test(r.name));
    assert.ok(upcoming, "upcoming table not parsed");
    assert.equal(upcoming.date?.slice(0, 10), "2026-03-20");
  });

  it("ignores the champion and PPV-buys tables", () => {
    // Those have no Event+Date pairing. A boxer's name must never become a card.
    for (const r of rows) {
      assert.doesNotMatch(r.name, /^(Amir Anderson|Zelfa Barrett|Dylan Price)$/);
    }
  });

  it("records a missing article rather than inventing one", () => {
    const orphan = rows.filter((r) => r.article === null);
    assert.ok(orphan.length > 0, "fixture should contain rows with no linked article");
    for (const r of orphan) assert.equal(r.article, null);
  });

  it("strips screen-reader CSS out of cell text", () => {
    // Cells render as "—.mw-parser-output .sr-only{border:0…}" — left in, that
    // becomes part of an event name.
    for (const r of rows) {
      assert.doesNotMatch(r.name, /mw-parser-output|sr-only/);
      assert.doesNotMatch(r.venue ?? "", /mw-parser-output/);
    }
  });
});

describe("over-attach guards — REGRESSION", () => {
  // Both guards exist because of a real, silent, severe fault caught in the first
  // dry run: 25 different Misfits cards each claiming one article's entire bout
  // list. X Series 001/002/003 all showed 21 bouts; 12 through 19 all showed 63.
  // Every card looked healthily populated and most of them were wrong.
  //
  // Driven through the injected fetcher, so no network.

  const SOURCE = { ...indexSourceFor("misfits")!, article: "IDX" };

  /** A card article with `n` readable bout rows. */
  const card = (n: number) =>
    `<table class="wikitable"><tbody>${Array.from({ length: n }, (_, i) =>
      `<tr><td>Lightweight</td><td>Red ${i}</td><td>def.</td><td>Blue ${i}</td><td>KO</td><td>1</td><td>1:00</td></tr>`,
    ).join("")}</tbody></table>`;

  const index = (rows: { name: string; date: string; link: string }[]) =>
    `<table class="wikitable"><tbody><tr><th>No.</th><th>Event</th><th>Date</th><th>Location</th></tr>${rows
      .map((r, i) =>
        `<tr><td>${i + 1}</td><td><a title="${r.link}" href="/wiki/x">${r.name}</a></td><td>${r.date}</td><td>The O2 Arena, London, England</td></tr>`,
      )
      .join("")}</tbody></table>`;

  it("refuses cards whose links REDIRECT to one shared article", async () => {
    // Distinct link titles, one resolved page — exactly the 001/002/003 case.
    // Deduping on the link title lets all three through.
    const pages: Record<string, { title: string; html: string }> = {
      IDX: { title: "IDX", html: index([
        { name: "Card A", date: "1 January 2024", link: "Link A" },
        { name: "Card B", date: "2 February 2024", link: "Link B" },
        { name: "Card C", date: "3 March 2024", link: "Link C" },
      ]) },
      "Link A": { title: "Shared Year Page", html: card(9) },
      "Link B": { title: "Shared Year Page", html: card(9) },
      "Link C": { title: "Shared Year Page", html: card(9) },
    };
    const { events, report } = await syncPromotionIndex({
      sources: [SOURCE],
      fetchArticle: async (t) => pages[t] ?? null,
    });

    assert.equal(events.length, 1, "only the first claimant may keep the article");
    assert.equal(events[0].name, "Card A");
    const shared = report.unusable.filter((u) => u.why.startsWith("shared article"));
    assert.equal(shared.length, 2);
    assert.deepEqual(shared.map((u) => u.name).sort(), ["Card B", "Card C"]);
  });

  it("refuses a single article carrying a whole season", async () => {
    const pages: Record<string, { title: string; html: string }> = {
      IDX: { title: "IDX", html: index([{ name: "Card A", date: "1 January 2024", link: "Year Page" }]) },
      "Year Page": { title: "Year Page", html: card(MAX_CARD_BOUTS + 1) },
    };
    const { events, report } = await syncPromotionIndex({
      sources: [SOURCE],
      fetchArticle: async (t) => pages[t] ?? null,
    });
    assert.equal(events.length, 0);
    assert.equal(report.unusable[0].why, "implausible bout count - looks like a season page");
  });

  it("still accepts a normal card", async () => {
    const pages: Record<string, { title: string; html: string }> = {
      IDX: { title: "IDX", html: index([{ name: "Card A", date: "1 January 2024", link: "Card A Page" }]) },
      "Card A Page": { title: "Card A Page", html: card(11) },
    };
    const { events } = await syncPromotionIndex({
      sources: [SOURCE],
      fetchArticle: async (t) => pages[t] ?? null,
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].fights?.length, 11);
    assert.equal(events[0].promotion, "Misfits Boxing");
    assert.equal(events[0].venue, "The O2 Arena");
  });

  it("the wikicard extractor really does read many bouts off a round-up page", () => {
    // The premise both guards rest on. If this stops being true they can be
    // relaxed — until then they are load-bearing.
    const bouts = parseWikiCard(INDEX);
    assert.ok(
      bouts.length === 0 || bouts.length > MAX_CARD_BOUTS,
      `an index page should yield nothing or implausibly many bouts, got ${bouts.length}`,
    );
  });
});

describe("resumability", () => {
  const SOURCE = { ...indexSourceFor("misfits")!, article: "IDX" };
  const idx = `<table class="wikitable"><tbody><tr><th>No.</th><th>Event</th><th>Date</th><th>Location</th></tr>
    <tr><td>1</td><td><a title="P1" href="/wiki/x">Card A</a></td><td>1 January 2024</td><td>London, England</td></tr>
    <tr><td>2</td><td><a title="P2" href="/wiki/x">Card B</a></td><td>2 February 2024</td><td>London, England</td></tr>
    </tbody></table>`;
  const bout = `<table class="wikitable"><tbody><tr><td>LW</td><td>Red</td><td>def.</td><td>Blue</td><td>KO</td><td>1</td><td>1:00</td></tr></tbody></table>`;
  const pages: Record<string, { title: string; html: string }> = {
    IDX: { title: "IDX", html: idx },
    P1: { title: "P1", html: bout },
    P2: { title: "P2", html: bout },
  };

  it("skips already-ingested cards WITHOUT spending a request", async () => {
    const fetched: string[] = [];
    const { events, report } = await syncPromotionIndex({
      sources: [SOURCE],
      skipArticles: new Set(["P1"]),
      fetchArticle: async (t) => { fetched.push(t); return pages[t] ?? null; },
    });
    assert.equal(report.cardsSkipped, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].name, "Card B");
    assert.ok(!fetched.includes("P1"), "a skipped card must not be fetched");
  });

  it("honours maxCards so a long backfill can be run in slices", async () => {
    const { events, report } = await syncPromotionIndex({
      sources: [SOURCE],
      maxCards: 1,
      fetchArticle: async (t) => pages[t] ?? null,
    });
    assert.equal(report.cardsFetched, 1);
    assert.equal(events.length, 1);
  });

  it("produces a stable externalId, so a rerun updates instead of duplicating", async () => {
    const run = () => syncPromotionIndex({ sources: [SOURCE], fetchArticle: async (t) => pages[t] ?? null });
    const a = await run();
    const b = await run();
    assert.deepEqual(a.events.map((e) => e.externalId), b.events.map((e) => e.externalId));
    assert.equal(a.events[0].externalId, "wp-index:P1");
  });

  it("survives a fetch that throws, without losing the rest of the run", async () => {
    const { events, report } = await syncPromotionIndex({
      sources: [SOURCE],
      fetchArticle: async (t) => {
        if (t === "P1") throw new Error("connection reset");
        return pages[t] ?? null;
      },
    });
    assert.equal(events.length, 1, "the healthy card must still land");
    assert.equal(report.warnings.length, 1);
    assert.match(report.warnings[0], /connection reset/);
  });
});

describe("source config", () => {
  it("records the source ladder that was actually walked", () => {
    for (const s of PROMOTION_INDEX_SOURCES) {
      // A promotion lands here only after API/JSON/embedded-JSON were checked
      // and lost. The note is the evidence, so it must be substantive.
      assert.ok(s.sourceLadder.length > 120, `${s.key}: sourceLadder is too thin to be evidence`);
      assert.match(s.sourceLadder, /ESPN/i);
    }
  });

  it("resolves misfits", () => {
    const m = indexSourceFor("misfits");
    assert.equal(m?.promotion, "Misfits Boxing");
    assert.equal(m?.sport, "BOXING");
  });

  it("has a unique key per source", () => {
    const keys = PROMOTION_INDEX_SOURCES.map((s) => s.key);
    assert.equal(new Set(keys).size, keys.length);
  });
});
