import { test } from "node:test";
import assert from "node:assert/strict";
import { confidenceOf, normalizeWeightClass, TRUST } from "../connector";
import { RANKING_SOURCES, ingestibleSources, sourceTierCounts } from "../sources";

test("NOTHING is ingestible by default — every source is opt-in (compliance gate)", () => {
  // Rankings were withdrawn pending a licensed source; the engine must not scrape
  // anything until an owner flips both `licensed` and `connectorReady`.
  assert.equal(ingestibleSources().length, 0);
  assert.ok(RANKING_SOURCES.every((s) => s.licensed === false));
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
