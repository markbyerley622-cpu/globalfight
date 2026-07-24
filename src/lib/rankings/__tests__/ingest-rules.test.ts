import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fighterSlug, weightClassSlug, divisionOrder,
  trustOf, shouldWriteRanking, movementFor, confidenceForSource,
} from "../ingest-rules";

test("fighterSlug is stable, accent- and case-insensitive", () => {
  assert.equal(fighterSlug("Chantelle Cameron"), "chantelle-cameron");
  assert.equal(fighterSlug("  Amanda  Serrano "), "amanda-serrano");
  assert.equal(fighterSlug("José Ramírez"), "jose-ramirez");
  // same person, two spacings → same identity, so no duplicate fighter
  assert.equal(fighterSlug("Katie Taylor"), fighterSlug("katie   taylor"));
});

test("weightClassSlug namespaces non-boxing sports only", () => {
  assert.equal(weightClassSlug("boxing", "Heavyweight"), "heavyweight");
  assert.equal(weightClassSlug("MMA", "Heavyweight"), "mma-heavyweight");
});

test("divisionOrder is heaviest-first, unknown sinks to the bottom", () => {
  assert.ok(divisionOrder("Heavyweight") < divisionOrder("Featherweight"));
  assert.equal(divisionOrder("Nonsenseweight"), 99);
});

test("manual/curated rows are never overwritten by any source", () => {
  assert.equal(shouldWriteRanking("curated", "wba-female"), false);
  assert.equal(shouldWriteRanking("manual", "wba-female"), false);
  assert.equal(trustOf("curated"), Number.POSITIVE_INFINITY);
});

test("precedence: higher trust wins, lower trust is skipped, same source refreshes", () => {
  // wba-female is 'official' (100); boxingscene is 'media' (80).
  assert.equal(shouldWriteRanking("boxingscene", "wba-female"), true, "official overwrites media");
  assert.equal(shouldWriteRanking("wba-female", "boxingscene"), false, "media cannot overwrite official");
  assert.equal(shouldWriteRanking("wba-female", "wba-female"), true, "a source refreshes itself");
  assert.equal(shouldWriteRanking(null, "wba-female"), true, "empty slot always writes");
});

test("movement reflects rank change", () => {
  assert.equal(movementFor(null, 5), "NEW");
  assert.equal(movementFor(8, 3), "UP");
  assert.equal(movementFor(3, 8), "DOWN");
  assert.equal(movementFor(4, 4), "SAME");
});

test("confidence maps from the source's trust tier", () => {
  assert.equal(confidenceForSource("wba-female"), 100);
  assert.equal(confidenceForSource("boxingscene"), 80);
  assert.equal(confidenceForSource("curated"), 100);
});
