import { test } from "node:test";
import assert from "node:assert/strict";
import { CURATED_P4P, curatedProvenance, CONFIDENCE_SCORE } from "../lists";
import { SPORTS } from "@/lib/sports";
import { fighterSlug } from "../../ingest-rules";

const SPORT_VALUES = new Set<string>(SPORTS.map((s) => s.value));

test("every curated list targets a real sport and is never boxing/MMA (engine-owned)", () => {
  for (const l of CURATED_P4P) {
    assert.ok(SPORT_VALUES.has(l.sport), `${l.sport} is a real Sport enum value`);
    assert.ok(l.sport !== "BOXING" && l.sport !== "MMA", `${l.sport} must be engine-driven, not curated`);
  }
});

test("ranks are contiguous 1..N with no gaps or duplicates", () => {
  for (const l of CURATED_P4P) {
    const ranks = l.entries.map((e) => e.rank).sort((a, b) => a - b);
    assert.deepEqual(ranks, l.entries.map((_, i) => i + 1), `${l.sport} ranks are 1..${l.entries.length}`);
  }
});

test("no duplicate fighters within a sport (identity by slug)", () => {
  for (const l of CURATED_P4P) {
    const slugs = l.entries.map((e) => fighterSlug(e.name));
    assert.equal(new Set(slugs).size, slugs.length, `${l.sport} has no duplicate fighters`);
  }
});

test("every list carries provenance: at least one source, a reason, a date, a confidence", () => {
  for (const l of CURATED_P4P) {
    assert.ok(l.sources.length >= 1, `${l.sport} cites a source`);
    for (const s of l.sources) assert.match(s.url, /^https:\/\//, `${l.sport} source URL is https`);
    assert.ok(l.reason.length > 10, `${l.sport} states how it was compiled`);
    assert.match(l.updated, /^\d{4}-\d{2}-\d{2}$/, `${l.sport} has an ISO date`);
    assert.ok(["HIGH", "MEDIUM", "LOW"].includes(l.confidence));
  }
});

test("a country code, when present, is a 2-letter ISO code (never invented long-form)", () => {
  for (const l of CURATED_P4P) {
    for (const e of l.entries) {
      if (e.countryCode !== null) assert.match(e.countryCode, /^[A-Z]{2}$/, `${e.name} country is ISO-2`);
    }
  }
});

test("curatedProvenance resolves for a curated sport and is null otherwise", () => {
  assert.ok(curatedProvenance("BJJ"));
  assert.equal(curatedProvenance("BOXING"), null);
  assert.equal(curatedProvenance("NONSENSE"), null);
});

test("confidence scores are ordered HIGH > MEDIUM > LOW", () => {
  assert.ok(CONFIDENCE_SCORE.HIGH > CONFIDENCE_SCORE.MEDIUM);
  assert.ok(CONFIDENCE_SCORE.MEDIUM > CONFIDENCE_SCORE.LOW);
});
