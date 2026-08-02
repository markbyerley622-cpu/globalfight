import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalizeTitle, sameTitle, normalizeText } from "../entities";

// ════════════════════════════════════════════════════════════════════════════
//  The duplicate-event bug, pinned.
//
//  ONE's extractor hand-rolled `.replace(/&amp;/g, "&")` — one entity, of the
//  three its JSON-LD emits. Eight cards were stored as "Kings &#038; Champions"
//  and slugged `kings-038-champions`, while the SAME cards arrived from
//  Wikipedia correctly named. Deduplication compared an encoded string to a
//  decoded one, correctly concluded they differed, and created a second row
//  per card — the encoded copy empty, the decoded one holding all ten bouts.
//
//  These are the exact stored values, taken from the database.
// ════════════════════════════════════════════════════════════════════════════

const REAL_DUPLICATES: Array<[encoded: string, decoded: string]> = [
  ["Kings &#038; Champions", "ONE Fighting Championship: Kings and Champions"],
  ["Champions &#038; Warriors", "ONE Fighting Championship: Champions and Warriors"],
  ["Honor &#038; Glory", "ONE Fighting Championship: Honor and Glory"],
  ["Grit &#038; Glory", "ONE Championship: Grit and Glory"],
  ["Fire &#038; Fury", "ONE Championship: Fire and Fury"],
];

test("the encoded and decoded forms of the SAME card canonicalize alike", () => {
  // The core claim. Each pair differs only by the promotion prefix, which the
  // event matcher strips separately — what matters here is that the entity and
  // the &/and split no longer make them different strings.
  for (const [encoded, decoded] of REAL_DUPLICATES) {
    const a = canonicalizeTitle(encoded);
    const b = canonicalizeTitle(decoded);
    assert.ok(b.endsWith(a), `"${a}" should be the tail of "${b}"`);
  }
});

test("&#038;, &amp;, &amp;amp; and a literal & all collapse to the same key", () => {
  const forms = [
    "Kings & Champions",
    "Kings &#038; Champions",
    "Kings &amp; Champions",
    "Kings &amp;amp; Champions",
    "Kings &#x26; Champions",
    "Kings and Champions",
  ];
  const keys = new Set(forms.map(canonicalizeTitle));
  assert.equal(keys.size, 1, `expected one key, got ${[...keys].join(" | ")}`);
  assert.equal([...keys][0], "kings and champions");
});

test("the apostrophe entity that produced warrior-8217-s-way is resolved", () => {
  // The second shape in the data: `&#8217;` slugged as a literal "8217".
  assert.equal(canonicalizeTitle("Warrior&#8217;s Way"), canonicalizeTitle("Warrior's Way"));
  assert.equal(canonicalizeTitle("Hero&#8217;s Dream"), canonicalizeTitle("Hero’s Dream"));
});

test("smart quotes, dashes and spacing variants agree", () => {
  assert.ok(sameTitle("UFC 300 — Pereira vs. Hill", "UFC 300 - Pereira vs Hill"));
  assert.ok(sameTitle("Fight Night: O’Malley", "Fight Night: O'Malley"));
  assert.ok(sameTitle("ONE  172", "ONE 172"));
  assert.ok(sameTitle("ONE 172", "ONE 172"));
});

test("Unicode composition differences agree (NFKC)", () => {
  // "é" as one code point vs "e" + combining acute — visually identical, and a
  // byte comparison calls them different events.
  assert.ok(sameTitle("José Aldo Night", "José Aldo Night"));
});

test("DIFFERENT events must NOT collapse — the dangerous direction", () => {
  // A canonicalizer that over-normalizes merges two real cards, which is worse
  // than the duplicate it was written to fix.
  assert.ok(!sameTitle("ONE 172", "ONE 173"));
  assert.ok(!sameTitle("UFC 300", "UFC 3000"));
  assert.ok(!sameTitle("Kings & Champions", "Kings & Warriors"));
  assert.ok(!sameTitle("ONE Friday Fights 46", "ONE Fight Night 46"));
  assert.ok(!sameTitle("Glory 38: Chicago", "Glory 38: Paris"));
});

test("empty and missing input never match anything, including each other", () => {
  assert.equal(canonicalizeTitle(""), "");
  assert.equal(canonicalizeTitle(null), "");
  assert.equal(canonicalizeTitle(undefined), "");
  assert.equal(sameTitle("", ""), false);
  assert.equal(sameTitle(null, undefined), false);
  assert.equal(sameTitle("UFC 300", ""), false);
});

test("canonicalizeTitle is idempotent", () => {
  for (const [encoded] of REAL_DUPLICATES) {
    const once = canonicalizeTitle(encoded);
    assert.equal(canonicalizeTitle(once), once);
  }
});

test("it is a MATCHING key, not a display value", () => {
  // Guards against anyone reaching for it to render a title. Storage uses
  // normalizeText, which preserves case and punctuation.
  assert.equal(canonicalizeTitle("Kings &#038; Champions"), "kings and champions");
  assert.equal(normalizeText("Kings &#038; Champions"), "Kings & Champions");
});

test("normalizeText fixes the stored value the extractor should have written", () => {
  // What the ONE extractor now produces, versus what it stored for two years.
  assert.equal(normalizeText("Kings &#038; Champions"), "Kings & Champions");
  assert.equal(normalizeText("Warrior&#8217;s Way"), "Warrior’s Way");
  assert.equal(normalizeText("Hero&#8217;s Ascent"), "Hero’s Ascent");
});
