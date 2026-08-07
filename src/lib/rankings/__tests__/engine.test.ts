import { test } from "node:test";
import assert from "node:assert/strict";
import { confidenceOf, normalizeWeightClass, TRUST } from "../connector";
import { RANKING_SOURCES, ingestibleSources, sourceTierCounts } from "../sources";

// The set of sources the owner has cleared. Changing this list is a LICENSING
// decision, so it is written here explicitly and the test below pins it: any
// source that becomes ingestible without being added here fails the suite.
//
// This assertion used to be `ingestibleSources().length === 0` — correct while
// rankings were withdrawn entirely, but it turns into a tripwire the moment a
// source is legitimately cleared, and the tempting fix is to delete the test and
// lose the guard with it. Pinning the exact set keeps the guard: it still fails
// on an accidental or unreviewed flip, it just no longer forbids the decision.
//
// wba-male added 2026-08-07 on the owner's explicit instruction — the reported
// symptom was "boxing champions are all women", and the cause was that every
// cleared boxing source was a female list. Same sanctioning body, same site,
// already-cleared publisher; the men's ratings are a second page of it.
// Verified against a captured live page before clearing (see connectors/wba.ts,
// which had a 404 URL and two parse defects that this flip would have shipped).
//
// wikipedia-boxing-male / -female added 2026-08-07 on the owner's explicit
// instruction ("scrape wikipedia for better boxing rankings"). The clearance
// rests on three things, all checkable:
//   · LICENCE — the pages are CC BY-SA, which permits reuse with attribution;
//     every emitted row carries its source URL (see connectors/wikipedia-boxing).
//   · PRECEDENT — this codebase already ingests the same publisher through the
//     same API for fight cards and results (lib/scraper/wikicard), so no new
//     publisher relationship is created here.
//   · NECESSITY — WBC, WBO and IBF are all `licensed: false` with no parser, and
//     BoxRec (which has them) is permanently blocklisted. Before this, three of
//     boxing's four major belts were absent from every division: the DB held 0
//     WBC, 0 WBO and 0 IBF champions.
// Scope is deliberately narrow: TITLEHOLDERS only, never contender ratings, and
// trust is `media` (→ ENCYCLOPAEDIC tier) so a sanctioning body's own connector
// always outranks it on its own belt.
const LICENSED_SOURCE_IDS = [
  "ufc-mma",
  "wba-female",
  "wba-male",
  "wikipedia-boxing-female",
  "wikipedia-boxing-male",
];

test("only the explicitly-cleared sources are ingestible (compliance gate)", () => {
  assert.deepEqual(ingestibleSources().map((s) => s.id).sort(), [...LICENSED_SOURCE_IDS].sort());

  // Everything else must still be opt-in — no source may be licensed without
  // being named above.
  const unexpected = RANKING_SOURCES.filter((s) => s.licensed && !LICENSED_SOURCE_IDS.includes(s.id));
  assert.deepEqual(unexpected.map((s) => s.id), [], "a source was licensed without being declared in this test");

  // A licensed source with no parser must not silently count as ingestible.
  for (const id of LICENSED_SOURCE_IDS) {
    const s = RANKING_SOURCES.find((x) => x.id === id)!;
    assert.equal(s.connectorReady, true, `${id} is licensed but has no ready connector`);
  }
});

test("BoxRec is present as reference but flagged never-ingest", () => {
  const boxrec = RANKING_SOURCES.find((s) => s.id === "boxrec");
  assert.ok(boxrec);
  assert.equal(boxrec!.licensed, false);
  assert.match(boxrec!.notes ?? "", /never ingested|FORBID/i);
});

test("official sanctioning bodies are Tier 1 with the highest trust", () => {
  for (const id of ["wba-female", "wbc-female", "ibf-female", "wbo-female"]) {
    const s = RANKING_SOURCES.find((x) => x.id === id)!;
    assert.equal(s.tier, 1);
    assert.equal(s.trust, "official");
  }
  assert.equal(confidenceOf({ trust: "official" }), 100);
  assert.ok(TRUST.official > TRUST.media && TRUST.media > TRUST.community);
});

test("tier counts cover the whole registry", () => {
  const c = sourceTierCounts();
  assert.equal(c[1] + c[2] + c[3], RANKING_SOURCES.length);
  assert.ok(c[1] >= 6); // the official bodies + federations
});

test("weight-class normalization folds common aliases", () => {
  assert.equal(normalizeWeightClass("junior welterweight"), "Super Lightweight");
  assert.equal(normalizeWeightClass("light welterweight"), "Super Lightweight");
  assert.equal(normalizeWeightClass("heavy"), "Heavyweight");
  assert.equal(normalizeWeightClass("welterweight"), "Welterweight");
});
