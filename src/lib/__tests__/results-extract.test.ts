import { test } from "node:test";
import assert from "node:assert/strict";
import { extractOutcome, extractRound, nameTokens } from "@/lib/results/extract";

// Extraction feeds settlement, which pays reputation and grades predictions. So the
// tests that matter most are the ones asserting it returns NOTHING: a false positive
// is far more expensive than another hour of "Results pending".

const BOUT = { redName: "Edgar Berlanga", blueName: "Steven Butler" };

// ── the real headlines from the live card ────────────────────────────────────

test("reads the actual live headline that we were missing", () => {
  const r = extractOutcome("Edgar Berlanga Stops Steven Butler in Chaotic Ending", BOUT);
  assert.ok(r);
  assert.equal(r.outcome, "WIN");
  assert.equal(r.winner, "RED");
  assert.equal(r.method, "TKO");
});

test("reads a worded round", () => {
  const r = extractOutcome("Edgar Berlanga Survives Knockdown to Stop Steven Butler in Seven", BOUT);
  assert.ok(r);
  assert.equal(r.winner, "RED");
  assert.equal(r.method, "TKO");
  assert.equal(r.round, 7);
});

// ── every method form ───────────────────────────────────────────────────────

test("each method form is read, and only when actually stated", () => {
  const cases: [string, string | null][] = [
    ["Berlanga knocks out Butler in round 3", "KO"],
    ["Berlanga KOs Butler", "KO"],
    ["Berlanga stops Butler in the fourth", "TKO"],
    ["Berlanga submits Butler in round 2", "SUB"],
    ["Berlanga beats Butler by unanimous decision", "UD"],
    ["Berlanga beats Butler by split decision", "SD"],
    ["Berlanga beats Butler by majority decision", "MD"],
    ["Butler disqualified as Berlanga takes the win", "DQ"],
    // Method-agnostic: a win with no stated method must stay null, never a guessed
    // decision — that would print a fabricated method on the bout page.
    ["Berlanga defeats Butler", null],
    ["Berlanga beats Butler", null],
    ["Berlanga def. Butler", null],
    ["Berlanga outpoints Butler", null],
  ];
  for (const [text, method] of cases) {
    const r = extractOutcome(text, BOUT);
    assert.ok(r, text);
    assert.equal(r.method, method, text);
    assert.equal(r.winner, "RED", text);
  }
});

test("a draw and a no contest have no winner", () => {
  const d = extractOutcome("Berlanga and Butler fight to a draw", BOUT);
  assert.equal(d?.outcome, "DRAW");
  assert.equal(d?.winner, null);

  const nc = extractOutcome("Berlanga vs Butler ruled a no contest", BOUT);
  assert.equal(nc?.outcome, "NO_CONTEST");
  assert.equal(nc?.winner, null);
});

// ── winner is POSITIONAL, never sentiment ───────────────────────────────────

test("the loser named first does not win", () => {
  const r = extractOutcome("Steven Butler stopped by Edgar Berlanga in the seventh", BOUT);
  // "stopped by" puts Butler before the verb. This reading is genuinely ambiguous to
  // a positional reader, so refusing it is correct — better null than backwards.
  if (r) assert.notEqual(r.winner, "BLUE", "must never credit the loser");
});

test("reversing the names reverses the winner", () => {
  const a = extractOutcome("Berlanga stops Butler", BOUT);
  const b = extractOutcome("Butler stops Berlanga", BOUT);
  assert.equal(a?.winner, "RED");
  assert.equal(b?.winner, "BLUE");
});

test("sentiment words are not outcomes — a survived win is still a win", () => {
  const r = extractOutcome("Berlanga survives a scare to stop Butler in round 7", BOUT);
  assert.equal(r?.winner, "RED");
});

// ── THE REFUSALS. These are the tests that protect settlement. ──────────────

test("a PREVIEW is refused", () => {
  for (const text of [
    "Where the major damage will land in Edgar Berlanga vs. Steven Butler",
    "Edgar Berlanga vs. Steven Butler Live Results and Fight Updates",
    "Berlanga set to face Butler in New York",
    "How to watch Berlanga vs Butler",
    "Berlanga vs Butler odds and prediction",
  ]) {
    assert.equal(extractOutcome(text, BOUT), null, text);
  }
});

test("a QUOTE or an intention is refused", () => {
  for (const text of [
    "“I Know I'm Better Than Him”: Steven Butler Vows To Knock Out Edgar Berlanga",
    "Edgar Berlanga Wants Munguia, Eubank Jr. After Butler Scare",
    "Butler promises to stop Berlanga",
    "Berlanga aims to knock out Butler",
  ]) {
    assert.equal(extractOutcome(text, BOUT), null, text);
  }
});

test("a RUMOUR is refused", () => {
  assert.equal(extractOutcome("Berlanga reportedly stops Butler", BOUT), null);
  assert.equal(extractOutcome("Berlanga allegedly beat Butler", BOUT), null);
});

test("a QUESTION is refused", () => {
  assert.equal(extractOutcome("Did Berlanga really stop Butler?", BOUT), null);
});

test("text naming only ONE of the two fighters is refused", () => {
  // This is what stops a co-main result being attached to the main event.
  assert.equal(extractOutcome("Berlanga stops Mendoza in the third", BOUT), null);
  assert.equal(extractOutcome("Butler wins on the night", BOUT), null);
});

test("text about a DIFFERENT bout entirely is refused", () => {
  assert.equal(
    extractOutcome("Richardson Hitchins outpoints Ricardo Salas Rodriguez", BOUT),
    null,
  );
});

test("both names on the same side of the verb is refused", () => {
  assert.equal(extractOutcome("Berlanga and Butler both looked sharp and beat expectations", BOUT), null);
});

test("two fighters sharing a surname are refused rather than guessed", () => {
  const brothers = { redName: "Jake Paul", blueName: "Logan Paul" };
  assert.equal(extractOutcome("Paul stops Paul in the second", brothers), null);
});

// ── rounds ──────────────────────────────────────────────────────────────────

test("round forms are read", () => {
  assert.equal(extractRound("stopped in round 7"), 7);
  assert.equal(extractRound("stopped in the 7th round"), 7);
  assert.equal(extractRound("stopped in the seventh"), 7);
  assert.equal(extractRound("TKO R2"), 2);
  assert.equal(extractRound("ninth round stoppage"), 9);
});

test("a bare number is NEVER a round", () => {
  // "3 knockdowns" must not become round 3.
  assert.equal(extractRound("Berlanga scored 3 knockdowns"), null);
  assert.equal(extractRound("a 12-fight unbeaten run"), null);
});

test("an impossible round is rejected", () => {
  assert.equal(extractRound("round 99"), null);
  assert.equal(extractRound("round 0"), null);
});

test("a stoppage with no round scores lower than one with a round", () => {
  const withRound = extractOutcome("Berlanga stops Butler in round 7", BOUT);
  const without = extractOutcome("Berlanga stops Butler", BOUT);
  assert.ok(withRound && without);
  assert.ok(withRound.quality > without.quality, "a complete reading is worth more");
});

// ── name handling ───────────────────────────────────────────────────────────

test("diacritics and suffixes do not break matching", () => {
  const bout = { redName: "Canelo Álvarez", blueName: "Edgar Berlanga Jr" };
  const r = extractOutcome("Alvarez beats Berlanga by unanimous decision", bout);
  assert.equal(r?.winner, "RED");
});

test("generational suffixes are not identifying tokens", () => {
  assert.ok(!nameTokens("Edgar Berlanga Jr").includes("jr"));
});

test("empty and junk input returns null rather than throwing", () => {
  assert.equal(extractOutcome("", BOUT), null);
  assert.equal(extractOutcome("   ", BOUT), null);
  assert.equal(extractOutcome("...", BOUT), null);
});
