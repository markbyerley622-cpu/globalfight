import { test } from "node:test";
import assert from "node:assert/strict";
import {
  officialResultFrom,
  selectHeroVideo,
  enrichmentConfidence,
  coverageTerms,
} from "../enrichment-derive";
import type { Fight } from "@/lib/types";
import type { VideoRec } from "@/lib/feed/recommend";

// Everything the enrichment engine derives is read from stored data — these
// tests pin that: a decided fight yields the recorded winner, an undecided one
// yields nothing (never a guess).

const fighter = (id: string, name: string) => ({ id, slug: id, name });
const fight = (over: Partial<Fight>): Fight =>
  ({
    id: "f1",
    slug: "f1",
    red: fighter("red", "Tyson Fury"),
    blue: fighter("blue", "Mariusz Wach"),
    titleFight: false,
    mainEvent: true,
    result: "SCHEDULED",
    scheduledRounds: 12,
    ...over,
  }) as unknown as Fight;

const vid = (title: string): VideoRec => ({
  id: title,
  title,
  channel: "c",
  publishedAt: null,
  promotion: null,
  promotionName: null,
  reason: "x",
});

test("officialResultFrom reads a decided win from stored fields — no inference", () => {
  const r = officialResultFrom(
    fight({ result: "WIN", winnerId: "red", method: "KO", roundEnded: 3, timeEnded: "1:24" }),
  );
  assert.equal(r?.outcome, "win");
  assert.equal(r?.winnerName, "Tyson Fury");
  assert.equal(r?.loserName, "Mariusz Wach");
  assert.equal(r?.method, "KO");
  assert.equal(r?.round, 3);
  assert.equal(r?.time, "1:24");
});

test("officialResultFrom surfaces draw and no-contest without naming a winner", () => {
  assert.deepEqual(
    { o: officialResultFrom(fight({ result: "DRAW" }))?.outcome, w: officialResultFrom(fight({ result: "DRAW" }))?.winnerName },
    { o: "draw", w: null },
  );
  assert.equal(officialResultFrom(fight({ result: "NO_CONTEST" }))?.outcome, "no-contest");
});

test("officialResultFrom returns null when nothing is decided (no fabricated result)", () => {
  assert.equal(officialResultFrom(fight({ result: "SCHEDULED" })), null);
  assert.equal(officialResultFrom(fight({ result: "WIN" })), null); // WIN but no winnerId → undetermined
  assert.equal(officialResultFrom(undefined), null);
});

test("selectHeroVideo features the top highlight post-fight, nothing pre-fight", () => {
  const videos = [vid("Fury fight-week vlog"), vid("Fury vs Wach HIGHLIGHTS"), vid("Fury interview")];
  assert.equal(selectHeroVideo(videos, "post")?.title, "Fury vs Wach HIGHLIGHTS");
  assert.equal(selectHeroVideo(videos, "pre"), null);
  assert.equal(selectHeroVideo([vid("Fury interview")], "post"), null); // no highlight → no hero
});

test("enrichmentConfidence scores completeness; a fully-enriched card outscores a bare one", () => {
  const rich = enrichmentConfidence({
    phase: "post",
    officialResult: { winnerName: "A", loserName: "B", titleFight: true, outcome: "win" },
    heroVideo: vid("A vs B HIGHLIGHTS"),
    featuredCoverage: { id: "a" } as never,
    coverageCount: 5,
    videoCount: 3,
  });
  const bare = enrichmentConfidence({
    phase: "post",
    officialResult: null,
    heroVideo: null,
    featuredCoverage: null,
    coverageCount: 0,
    videoCount: 0,
  });
  assert.equal(rich, 100);
  assert.equal(bare, 0);
  assert.ok(rich > bare);
});

test("coverageTerms = surnames + promotion aliases + event name; 'various' excluded", () => {
  const terms = coverageTerms("bkfc", [fight({})], "BKFC 91");
  assert.ok(terms.includes("fury"));
  assert.ok(terms.includes("wach"));
  assert.ok(terms.includes("bkfc"));
  assert.ok(terms.includes("bare knuckle"), "promotion alias is expanded");
  assert.ok(terms.includes("bkfc 91"), "event name is a term");
  assert.ok(!coverageTerms("various", [fight({})], "Card").includes("various"));
});
