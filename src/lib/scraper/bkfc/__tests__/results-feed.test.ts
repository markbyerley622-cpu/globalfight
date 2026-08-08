// ════════════════════════════════════════════════════════════════════════════
//  BKFC official results feed — against REAL captured payloads.
//
//    event-bkfc-10-results.html  BKFC 10 (Lombard vs Mundell, 2020-02-15). The
//                                page that carries all four result variants
//                                unmarked and `WinMethod` = "TBU" — the reason
//                                the DOM card can never yield a winner.
//    feed-v1-bkfc-10.json        v1 shape: Bouts is an ARRAY of string values.
//    feed-v2-budva.json          v2 shape: Bouts is an OBJECT keyed Bout1..N
//                                with typed values. A parser that assumed the
//                                array shape read 11 of 20 sampled events as
//                                empty — this fixture is why both are tested.
// ════════════════════════════════════════════════════════════════════════════

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as cheerio from "cheerio";
import {
  extractStatsFeedUrl,
  normalizeFeedBouts,
  parseFeedCard,
  cardFighterIndex,
  resolveCornerSlug,
  feedCardToBouts,
  verifyFeedCard,
} from "../results-feed";
import { parseEventPage } from "../extract/events";
import { toNormalizedEvent } from "../map";

const DIR = dirname(fileURLToPath(import.meta.url));
const fx = (n: string) => readFileSync(join(DIR, "fixtures", n), "utf8");

const PAGE = fx("event-bkfc-10-results.html");
const V1 = JSON.parse(fx("feed-v1-bkfc-10.json"));
const V2 = JSON.parse(fx("feed-v2-budva.json"));

test("the feed URL is declared in the page's own inline script", () => {
  const url = extractStatsFeedUrl(PAGE);
  assert.ok(url, "BKFC 10 declares a FINAL_STATS feed");
  assert.match(url!, /^https:\/\/xapi\.mmareg\.com\//);
  // Entity-decoded: a raw `&amp;` would carry "amp;" into every later param.
  assert.ok(!url!.includes("&amp;"), "query separators must be decoded");
  assert.match(url!, /id=312/);
});

test("a type=xml feed URL is forced back to JSON", () => {
  // One sampled page (BKFC 44) embeds type=xml and the endpoint honours it.
  const html = `<script>const FINAL_STATS = 'https://xapi.mmareg.com/api/v2/bkfc/?type=xml&amp;modifier=event-stats&amp;id=506';</script>`;
  assert.equal(
    extractStatsFeedUrl(html),
    "https://xapi.mmareg.com/api/v2/bkfc/?type=json&modifier=event-stats&id=506",
  );
});

test("a feed URL pointing anywhere else is refused", () => {
  const html = `<script>const FINAL_STATS = 'https://evil.example.com/api/bkfc?type=json&amp;id=1';</script>`;
  assert.equal(extractStatsFeedUrl(html), null);
});

test("no feed declared is null, not an error (an unannounced card)", () => {
  assert.equal(extractStatsFeedUrl("<html></html>"), null);
  assert.equal(extractStatsFeedUrl(`<script>const FINAL_STATS = '';const LIVE_STATS = '';</script>`), null);
});

test("both response shapes normalise to the same bout list", () => {
  const a = normalizeFeedBouts(V1);
  const b = normalizeFeedBouts(V2);
  assert.equal(a.length, 8, "v1 array shape");
  assert.equal(b.length, 9, "v2 object shape");
  for (const list of [a, b]) {
    for (const x of list) {
      assert.ok(x.redLastName && x.blueLastName, "both corners named");
      assert.ok(Number.isFinite(x.boutNumber));
      assert.ok(x.redResult && x.blueResult, "a completed card states both corners");
    }
  }
});

test("v2's Bout1..BoutN keys sort numerically, not as text", () => {
  // Text ordering puts "Bout10" before "Bout2" and silently scrambles the card.
  const nums = normalizeFeedBouts(V2).map((b) => b.boutNumber);
  assert.deepEqual(nums, [...nums].sort((x, y) => x - y));
});

test("the card is emitted MAIN EVENT FIRST (the feed lists it last)", () => {
  const card = parseFeedCard(V1)!;
  const index = cardFighterIndex(cheerio.load(PAGE));
  const bouts = feedCardToBouts(card, index);

  assert.equal(bouts.length, 8);
  assert.equal(bouts[0].mainEvent, true);
  assert.equal(bouts[1].coMain, true);
  // BKFC 10 is "Lombard vs Mundell" — the event's own namesake is the main event.
  assert.match(`${bouts[0].redName} ${bouts[0].blueName}`, /Lombard/);
  assert.match(`${bouts[0].redName} ${bouts[0].blueName}`, /Mundell/);
  // Exactly one main event on the card.
  assert.equal(bouts.filter((b) => b.mainEvent).length, 1);
});

test("results, method, round, time and ruleset all come off the feed", () => {
  const card = parseFeedCard(V1)!;
  const bouts = feedCardToBouts(card, cardFighterIndex(cheerio.load(PAGE)));
  for (const b of bouts) {
    assert.ok(b.winnerCorner === "red" || b.winnerCorner === "blue", `${b.redName} vs ${b.blueName} decided`);
    assert.ok(b.method, "method stated");
    assert.ok(b.roundEnded && b.roundEnded > 0, "round stated");
    assert.ok(b.timeEnded, "time stated");
    assert.equal(b.ruleset, "BARE KNUCKLE BOXING");
    assert.ok(b.scheduledRounds && b.scheduledRounds > 0);
  }
});

test("feed athletes resolve to the EXISTING bkfc.com slug namespace", () => {
  const card = parseFeedCard(V1)!;
  const index = cardFighterIndex(cheerio.load(PAGE));
  const bouts = feedCardToBouts(card, index);

  // The feed's own AthleteUUID is a different namespace from the page slugs our
  // fighters are already stored under. Emitting the UUID would miss the existing
  // row and risk a duplicate, so the corner is resolved back to the page slug.
  const main = bouts[0];
  const slugs = [main.redSlug, main.blueSlug];
  assert.ok(slugs.includes("hector-lightning-lombard"), `got ${JSON.stringify(slugs)}`);
  assert.ok(slugs.includes("david-mundell"), `got ${JSON.stringify(slugs)}`);

  // A resolved slug is always one the page actually links — never invented.
  for (const b of bouts) {
    for (const s of [b.redSlug, b.blueSlug]) {
      if (s) assert.ok(index.has(s), `${s} is not linked on the card`);
    }
  }
});

test("an unresolvable corner is null, never a wrong slug", () => {
  const index = new Map([
    ["david-mundell", "DAVID MUNDELL"],
    ["hector-lightning-lombard", "Héctor 'Lightning' Lombard"],
  ]);
  // Accents and the nickname in the slug must not defeat the match.
  assert.equal(resolveCornerSlug("Héctor", "Lombard", index), "hector-lightning-lombard");
  assert.equal(resolveCornerSlug("Hector", "Lombard", index), "hector-lightning-lombard");
  // Someone who simply is not on this card resolves to nothing.
  assert.equal(resolveCornerSlug("Conor", "McGregor", index), null);
  // A surname alone that matches nobody stays null.
  assert.equal(resolveCornerSlug("", "Nobody", index), null);
});

test("apostrophes close up rather than splitting, matching BKFC's slugs", () => {
  const index = new Map([["reggie-obannon", "Reggie O'Bannon"]]);
  assert.equal(resolveCornerSlug("Reggie", "O'Bannon", index), "reggie-obannon");
  assert.equal(resolveCornerSlug("Reggie", "O’Bannon", index), "reggie-obannon"); // curly
});

test("a shared surname does not silently pick one brother", () => {
  const index = new Map([
    ["chris-smith", "Chris Smith"],
    ["charlie-smith", "Charlie Smith"],
  ]);
  // "C. Smith" matches both on surname and neither uniquely on given name.
  assert.equal(resolveCornerSlug("C", "Smith", index), null);
  // ...but a full given name is unambiguous.
  assert.equal(resolveCornerSlug("Chris", "Smith", index), "chris-smith");
});

test("a feed card for a DIFFERENT event is rejected, not attached", () => {
  const card = parseFeedCard(V1)!; // BKFC 10 — Feb 15 2020
  assert.equal(verifyFeedCard({ date: "2020-02-15T00:00:00.000Z", name: "BKFC 10" }, card).ok, true);

  // BKFC reuses city names across years, so the DATE is what must agree.
  const wrong = verifyFeedCard({ date: "2023-07-01T00:00:00.000Z", name: "BKFC Hollywood" }, card);
  assert.equal(wrong.ok, false);
  assert.match((wrong as { reason: string }).reason, /date mismatch/);
});

test("end-to-end: the canonical event carries decided bouts", () => {
  const e = parseEventPage(PAGE, "https://www.bkfc.com/events/bkfc-10-lombard-vs-mundell")!;
  // Without the feed the DOM card is still produced — with no results.
  assert.ok(e.bouts.length > 0);
  assert.equal(e.bouts.every((b) => b.winnerCorner === null), true, "DOM alone never has a winner");

  // With the feed applied, the same event maps to decided canonical stubs.
  e.bouts = feedCardToBouts(parseFeedCard(V1)!, cardFighterIndex(cheerio.load(PAGE)));
  const n = toNormalizedEvent(e, "2026-08-08T00:00:00.000Z");
  const fights = n.fights ?? [];
  assert.equal(fights.length, 8);
  for (const f of fights) {
    assert.equal(f.result, "WIN");
    assert.ok(f.method, "method mapped to the enum");
    assert.equal(f.ruleset, "BARE_KNUCKLE");
    assert.equal(f.rulesetConfidence, 1); // stated on the bout, not derived
    assert.ok(
      f.winnerExternalId === f.redExternalId || f.winnerExternalId === f.blueExternalId,
      "the winner is one of this bout's own corners",
    );
  }
});

test("a card with no feed maps to SCHEDULED, never a guessed result", () => {
  const e = parseEventPage(PAGE, "https://www.bkfc.com/events/bkfc-10-lombard-vs-mundell")!;
  const n = toNormalizedEvent(e, "2026-08-08T00:00:00.000Z"); // DOM card, no feed applied
  for (const f of n.fights ?? []) {
    assert.equal(f.result, undefined, "no result is stored rather than an invented one");
    assert.equal(f.winnerExternalId, undefined);
  }
});

test("malformed payloads degrade to nothing rather than throwing", () => {
  for (const bad of [null, undefined, "", 42, "a string", {}, { Bouts: "nope" }, { Bouts: [1, 2] }]) {
    assert.deepEqual(normalizeFeedBouts(bad), []);
    assert.equal(parseFeedCard(bad), null);
  }
});
