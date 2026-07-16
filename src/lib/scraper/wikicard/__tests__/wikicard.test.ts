// Wikipedia fight-card extractor + mapping, against a real captured WP page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseWikiCard } from "../extract";
import { toFightStub, toNormalizedWikiEvent } from "../map";

const DIR = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(DIR, "fixtures", "one-fight-night-39.html"), "utf8");

test("parseWikiCard extracts bouts with results from a toccolours table", () => {
  const bouts = parseWikiCard(html);
  assert.ok(bouts.length >= 5, `expected a card, got ${bouts.length}`);
  for (const b of bouts) {
    assert.ok(b.redName && b.blueName, "both corners named");
    assert.notEqual(b.redName, b.blueName);
  }
  // The page is a completed event → results present.
  assert.ok(bouts.some((b) => b.decided && b.method), "methods captured");
  assert.ok(bouts.some((b) => b.round !== null), "rounds captured");
  // Per-bout ruleset is recognised (ONE cards mix Muay Thai / kickboxing / MMA).
  assert.ok(bouts.some((b) => b.ruleset === "muay thai"), "ruleset detected");
});

test("fighter names are stripped of champion markers", () => {
  const bouts = parseWikiCard(html);
  for (const b of bouts) {
    assert.doesNotMatch(b.redName, /\(c\)/i);
    assert.doesNotMatch(b.blueName, /\(c\)/i);
  }
});

test("toFightStub maps result/method/winner ('def.' = red wins)", () => {
  const stub = toFightStub(
    {
      weightClass: "Bantamweight", ruleset: "muay thai", redName: "A Fighter", blueName: "B Fighter",
      decided: true, method: "KO (punch to the body)", round: 2, time: "2:41", titleFight: false,
    },
    0,
  );
  assert.equal(stub.result, "WIN");
  assert.equal(stub.method, "KO");
  assert.equal(stub.roundEnded, 2);
  assert.equal(stub.winnerExternalId, stub.redExternalId); // red won
  assert.equal(stub.mainEvent, true); // index 0
});

test("an undecided bout ('vs.') carries no winner", () => {
  const stub = toFightStub(
    {
      weightClass: "Flyweight", ruleset: null, redName: "A", blueName: "B",
      decided: false, method: null, round: null, time: null, titleFight: false,
    },
    1,
  );
  assert.equal(stub.result, "SCHEDULED");
  assert.equal(stub.winnerExternalId, undefined);
  assert.equal(stub.mainEvent, false);
});

test("toNormalizedWikiEvent carries provenance + the card", () => {
  const bouts = parseWikiCard(html);
  const e = toNormalizedWikiEvent(
    { name: "ONE Fight Night 39", date: "2026-01-01T00:00:00.000Z", sport: "MMA" },
    "ONE Fight Night 39",
    bouts,
    "2026-07-16T00:00:00.000Z",
  );
  assert.equal(e._meta.source, "wikipedia");
  assert.equal(e.sport, "MMA");
  assert.equal(e.fights?.length, bouts.length);
});

test("resilient to a page with no card", () => {
  assert.deepEqual(parseWikiCard("<html><body><p>no tables</p></body></html>"), []);
});
