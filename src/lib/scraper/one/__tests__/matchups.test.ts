// ════════════════════════════════════════════════════════════════════════════
//  ONE fight-card extraction, against REAL captured onefc.com pages.
//
//    one-167-card.html    ONE 167 — a four-ruleset card (Muay Thai, kickboxing,
//                         MMA, submission grappling) with a World Championship
//                         main event. This is the case the old "cards are
//                         client-side, so events carry no bouts" comment claimed
//                         was impossible.
//    fire-and-fury-nc.html  ONE: Fire & Fury — carries a NO CONTEST.
//    event.html           ONE Friday Fights 172 — announced but cardless, the
//                         "Card to be announced" state.
// ════════════════════════════════════════════════════════════════════════════

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as cheerio from "cheerio";
import { parseOneMatchups, weightClassFromLabel, roundFromMethodText } from "../extract/matchups";
import { parseOneEventPage } from "../extract/events";
import { toNormalizedOneEvent, toOneFightStub } from "../map";

const DIR = dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => readFileSync(join(DIR, "fixtures", n), "utf8");

const CARD = fixture("one-167-card.html");
const NC_CARD = fixture("fire-and-fury-nc.html");

test("reads the whole card off a static ONE event page", () => {
  const bouts = parseOneMatchups(cheerio.load(CARD));
  assert.equal(bouts.length, 10);
  // Every bout names both corners and links both athlete profiles.
  for (const b of bouts) {
    assert.ok(b.redName && b.blueName, `unnamed corner in "${b.label}"`);
    assert.ok(b.redExternalId && b.blueExternalId, `unlinked corner in "${b.label}"`);
  }
});

test("main event is first, and it is the title bout", () => {
  const [main] = parseOneMatchups(cheerio.load(CARD));
  assert.equal(main.order, 0);
  assert.equal(main.redName, "Tawanchai PK Saenchai");
  assert.equal(main.blueName, "Jo Nattawut");
  assert.equal(main.titleFight, true);
  assert.equal(main.weightClass, "Featherweight");
  assert.equal(main.label, "Featherweight Muay Thai World Championship");
});

test("the ruleset is read PER BOUT, not from the card", () => {
  const stubs = parseOneMatchups(cheerio.load(CARD)).map(toOneFightStub);
  const rulesets = stubs.map((s) => s.ruleset);
  // One ONE card, four rulesets — the whole reason Fight.ruleset exists.
  assert.deepEqual(
    [...new Set(rulesets)].sort(),
    ["KICKBOXING", "MMA", "MUAY_THAI", "SUBMISSION_GRAPPLING"],
  );
  // ...and it is STATED, so it outranks anything derived from the event.
  for (const s of stubs) assert.equal(s.rulesetConfidence, 1);
});

test("winner, method and round come off the sticker", () => {
  const stubs = parseOneMatchups(cheerio.load(CARD)).map(toOneFightStub);
  const main = stubs[0];
  assert.equal(main.result, "WIN");
  assert.equal(main.method, "MD"); // "Majority Decision (R5)"
  assert.equal(main.roundEnded, 5); // a five-round title fight
  assert.equal(main.winnerExternalId, main.redExternalId);

  // The winner is always one of the two corners on the bout — never a third id.
  for (const s of stubs) {
    if (s.result !== "WIN") continue;
    assert.ok(
      s.winnerExternalId === s.redExternalId || s.winnerExternalId === s.blueExternalId,
      `winner ${s.winnerExternalId} is on neither corner`,
    );
  }
});

test("a no contest is NO_CONTEST with no winner", () => {
  const stubs = parseOneMatchups(cheerio.load(NC_CARD)).map(toOneFightStub);
  const nc = stubs.filter((s) => s.result === "NO_CONTEST");
  assert.equal(nc.length, 1);
  assert.equal(nc[0].method, "NC");
  assert.equal(nc[0].winnerExternalId, undefined);
});

test("an unannounced card yields no bouts rather than invented ones", () => {
  const e = parseOneEventPage(fixture("event.html"), "https://www.onefc.com/events/one-friday-fights-172/")!;
  assert.deepEqual(e.bouts, []);
  assert.deepEqual(toNormalizedOneEvent(e, "2026-07-16T00:00:00.000Z").fights, []);
});

test("weightClassFromLabel strips ruleset and championship billing", () => {
  assert.equal(weightClassFromLabel("Flyweight Muay Thai"), "Flyweight");
  assert.equal(weightClassFromLabel("140 LBS Muay Thai"), "140 LBS");
  assert.equal(weightClassFromLabel("Interim Lightweight MMA World Championship"), "Lightweight");
  assert.equal(weightClassFromLabel("Women's Atomweight World Championship"), "Women's Atomweight");
  assert.equal(weightClassFromLabel("Lightweight Submission Grappling"), "Lightweight");
  assert.equal(weightClassFromLabel("Catchweight [68.0 KG]"), "Catchweight [68.0 KG]");
  assert.equal(weightClassFromLabel("Flyweight World Grand Prix Championship Final"), "Flyweight");
  assert.equal(weightClassFromLabel(null), null);
});

test("a Grand Prix final is not a world title fight", () => {
  const gp = { label: "Flyweight World Grand Prix Championship Final" };
  // Guarded here because the weight class strips "World ..." either way — only
  // the title flag distinguishes a belt from a tournament bracket.
  const $ = cheerio.load(
    `<div class="event-matchup"><div class="title">${gp.label}</div>
     <a class="face face1" href="/athletes/a/"><div class="sticker"></div></a>
     <a class="face face2" href="/athletes/b/"><div class="sticker"></div></a>
     <table><tr class="vs"><td>A Fighter</td><th>VS</th><td>B Fighter</td></tr></table></div>`,
  );
  const [b] = parseOneMatchups($);
  assert.equal(b.titleFight, false);
  // No sticker means ONE stated no outcome — SCHEDULED, not a guessed result.
  assert.equal(toOneFightStub(b).result, "SCHEDULED");
  assert.equal(toOneFightStub(b).method, undefined);
});

test("roundFromMethodText reads (R3) and tolerates ONE's bare (R)", () => {
  assert.equal(roundFromMethodText("Split Decision (R3)"), 3);
  assert.equal(roundFromMethodText("Knockout (R1)"), 1);
  assert.equal(roundFromMethodText("Unanimous Decision (R)"), null);
  assert.equal(roundFromMethodText(null), null);
});
