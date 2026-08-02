import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlaceholderName, isPlaceholderSlug, isRealBout } from "@/lib/entities/placeholder";

// "TBA" was upserted as a Fighter by every ingest path, so it had a row, a slug,
// a profile page, a 0-0-0 record and 15 sitemap URLs. The rule that stops that is
// only safe if it is anchored: a rule that matched substrings would 404 real
// fighters, which is a worse failure than the one it fixes.

test("the placeholder vocabulary is caught", () => {
  for (const n of [
    "TBA", "tba", " TBA ", "Opponent TBA", "opponent tba", "TBD", "TBC",
    "T.B.A", "T.B.D.", "To Be Announced", "to be determined", "To Be Named",
    "Unknown", "Unnamed", "Opponent", "Vacant", "N/A", "na",
  ]) {
    assert.equal(isPlaceholderName(n), true, `expected placeholder: ${n}`);
  }
});

test("an absent name is not a person either", () => {
  assert.equal(isPlaceholderName(null), true);
  assert.equal(isPlaceholderName(undefined), true);
  assert.equal(isPlaceholderName(""), true);
});

test("real fighters are never mistaken for placeholders", () => {
  // The anchoring test. Each of these CONTAINS a placeholder token; none of them
  // is one. Getting this wrong 404s a real profile.
  for (const n of [
    "Israel Adesanya", "Rose Namajunas", "Usman Nurmagomedov", "Archie Colgan",
    "Naoya Inoue", "Oleksandr Usyk", "Tbara Diallo", "Anatoly Malykhin",
    "The Unknown Warrior", "Nate Opponent-Smith", "Vacanti", "Nadia Kassem",
  ]) {
    assert.equal(isPlaceholderName(n), false, `expected real fighter: ${n}`);
  }
});

test("slugs are checked in their hyphenated form", () => {
  assert.equal(isPlaceholderSlug("tba"), true);
  assert.equal(isPlaceholderSlug("opponent-tba"), true);
  assert.equal(isPlaceholderSlug("to-be-announced"), true);
  assert.equal(isPlaceholderSlug("israel-adesanya"), false);
  assert.equal(isPlaceholderSlug("nate-opponent-smith"), false);
});

test("a bout is real only when BOTH corners are named", () => {
  assert.equal(isRealBout("Israel Adesanya", "Sean Strickland"), true);
  assert.equal(isRealBout("Israel Adesanya", "TBA"), false);
  assert.equal(isRealBout("Opponent TBA", "Sean Strickland"), false);
  assert.equal(isRealBout("TBA", "TBD"), false);
  assert.equal(isRealBout("Israel Adesanya", null), false);
});
