import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreCandidate, DEFAULT_THRESHOLDS, type EvidenceInput } from "@/lib/results/confidence";
import { voiceKey, sourceKindFor } from "@/lib/results/sources";

// The engine's job is to be RELUCTANT. These tests mostly assert that things do NOT
// reach VERIFIED, because VERIFIED is what triggers settlement — reputation, graded
// predictions, notifications. Only a clean, corroborated, uncontested reading passes.

const ev = (over: Partial<EvidenceInput> = {}): EvidenceInput => ({
  sourceUrl: "https://espn.com/story",
  outcome: "WIN",
  winner: "RED",
  method: "TKO",
  round: 7,
  quality: 0.8,
  ...over,
});

// ── source classification ───────────────────────────────────────────────────

test("hosts classify, and an unknown host is UNKNOWN not MAJOR", () => {
  assert.equal(sourceKindFor("https://en.wikipedia.org/wiki/X"), "WIKIPEDIA");
  assert.equal(sourceKindFor("https://www.ufc.com/news/x"), "OFFICIAL");
  assert.equal(sourceKindFor("https://espn.com/x"), "MAJOR");
  assert.equal(sourceKindFor("https://boxingnews24.com/x"), "TRADE");
  // A source we have never characterised must not be able to carry a candidate on
  // its own. Adding one is a deliberate, reviewable line of code.
  assert.equal(sourceKindFor("https://some-random-blog.example/x"), "UNKNOWN");
});

test("aggregators collapse to ONE voice; independents do not", () => {
  assert.equal(voiceKey("https://news.google.com/a"), voiceKey("https://msn.com/b"));
  assert.notEqual(voiceKey("https://espn.com/a"), voiceKey("https://bbc.co.uk/b"));
  // Two articles from the SAME outlet are also one voice — a follow-up is not a
  // second confirmation.
  assert.equal(voiceKey("https://espn.com/a"), voiceKey("https://espn.com/b"));
});

// ── the reluctance ──────────────────────────────────────────────────────────

test("no evidence yields no candidate", () => {
  assert.equal(scoreCandidate([]), null);
});

test("ONE trade source alone never auto-publishes", () => {
  const c = scoreCandidate([ev({ sourceUrl: "https://boxingnews24.com/x" })]);
  assert.ok(c);
  assert.notEqual(c.status, "VERIFIED");
  assert.equal(c.agreeing, 1);
});

test("ONE major source alone never auto-publishes — corroboration is required", () => {
  const c = scoreCandidate([ev({ sourceUrl: "https://espn.com/x", quality: 1 })]);
  assert.ok(c);
  assert.notEqual(c.status, "VERIFIED", "a single voice cannot settle a bout");
});

test("five AGGREGATORS agreeing is still one voice and does not verify", () => {
  // The rumour-amplification case: syndicated copies must not look like consensus.
  const c = scoreCandidate([
    ev({ sourceUrl: "https://news.google.com/1" }),
    ev({ sourceUrl: "https://msn.com/2" }),
    ev({ sourceUrl: "https://yahoo.com/3" }),
    ev({ sourceUrl: "https://flipboard.com/4" }),
    ev({ sourceUrl: "https://news.google.com/5" }),
  ]);
  assert.ok(c);
  assert.equal(c.agreeing, 1);
  assert.notEqual(c.status, "VERIFIED");
});

test("two independent trusted sources agreeing DOES verify", () => {
  const c = scoreCandidate([
    ev({ sourceUrl: "https://espn.com/x", quality: 0.9 }),
    ev({ sourceUrl: "https://bbc.co.uk/y", quality: 0.9 }),
  ]);
  assert.ok(c);
  assert.equal(c.status, "VERIFIED");
  assert.equal(c.agreeing, 2);
  assert.equal(c.winner, "RED");
  assert.equal(c.method, "TKO");
  assert.equal(c.round, 7);
});

// ── CONFLICT beats confidence. This is the core safety property. ────────────

test("a credible dissenter forces CONFLICTED even with strong support", () => {
  const c = scoreCandidate([
    ev({ sourceUrl: "https://espn.com/x", quality: 1 }),
    ev({ sourceUrl: "https://bbc.co.uk/y", quality: 1 }),
    ev({ sourceUrl: "https://skysports.com/z", quality: 1 }),
    // One says the other fighter won.
    ev({ sourceUrl: "https://mmafighting.com/w", winner: "BLUE", quality: 0.9 }),
  ]);
  assert.ok(c);
  assert.equal(c.status, "CONFLICTED", "disagreement about the WINNER must reach a human");
  assert.equal(c.disagreeing, 1);
  assert.ok(c.reasons.some((r) => r.startsWith("CONFLICT")), "the conflict is explained first");
});

test("the exact scenario from the brief: TKO round 7 vs a decision", () => {
  const c = scoreCandidate([
    ev({ sourceUrl: "https://espn.com/a", method: "TKO", round: 7 }),
    ev({ sourceUrl: "https://bbc.co.uk/b", method: "UD", round: null }),
  ]);
  assert.ok(c);
  // Both agree RED won, so this is not a winner conflict — but the METHOD is
  // contested, and publishing a contested stoppage round as fact is wrong.
  assert.equal(c.winner, "RED");
  assert.notEqual(c.status, "VERIFIED");
  assert.ok(c.reasons.some((r) => /method/i.test(r)));
});

test("a draw reported against a win is a conflict", () => {
  const c = scoreCandidate([
    ev({ sourceUrl: "https://espn.com/a" }),
    ev({ sourceUrl: "https://bbc.co.uk/b", outcome: "DRAW", winner: null, method: "DRAW" }),
  ]);
  assert.equal(c?.status, "CONFLICTED");
});

test("a lone junk dissenter does not derail a strong consensus", () => {
  // An UNKNOWN source with poor extraction is below the credibility floor, so it is
  // recorded but does not force a human. Otherwise one bad blog could block every
  // result on the card.
  const c = scoreCandidate([
    ev({ sourceUrl: "https://espn.com/a", quality: 1 }),
    ev({ sourceUrl: "https://bbc.co.uk/b", quality: 1 }),
    ev({ sourceUrl: "https://random.example/c", winner: "BLUE", quality: 0.2 }),
  ]);
  assert.ok(c);
  assert.equal(c.status, "VERIFIED");
});

// ── thresholds and detail ───────────────────────────────────────────────────

test("weak evidence is INCONCLUSIVE and stores without acting", () => {
  const c = scoreCandidate([ev({ sourceUrl: "https://random.example/x", quality: 0.2 })]);
  assert.ok(c);
  assert.equal(c.status, "INCONCLUSIVE");
});

test("thresholds are configurable", () => {
  const evidence = [ev({ sourceUrl: "https://boxingnews24.com/x", quality: 0.7 })];
  assert.notEqual(scoreCandidate(evidence)?.status, "VERIFIED");
  // A deployment that decides one trade source is enough can say so.
  const relaxed = scoreCandidate(evidence, { autoPublish: 0.2, autoPublishVoices: 1, review: 0.1 });
  assert.equal(relaxed?.status, "VERIFIED");
});

test("detail is taken by consensus, not from the loudest source", () => {
  // Two sources say round 7, one says round 9. The wire report is often first and
  // thinnest; the majority carries the round.
  const c = scoreCandidate([
    ev({ sourceUrl: "https://espn.com/a", round: 9 }),
    ev({ sourceUrl: "https://bbc.co.uk/b", round: 7 }),
    ev({ sourceUrl: "https://skysports.com/c", round: 7 }),
  ]);
  assert.equal(c?.round, 7);
});

test("a method nobody stated stays null rather than being invented", () => {
  const c = scoreCandidate([
    ev({ sourceUrl: "https://espn.com/a", method: null, round: null }),
    ev({ sourceUrl: "https://bbc.co.uk/b", method: null, round: null }),
  ]);
  assert.equal(c?.method, null);
  assert.ok(c?.reasons.some((r) => /no method/i.test(r)));
});

test("every candidate is explainable", () => {
  const c = scoreCandidate([ev(), ev({ sourceUrl: "https://bbc.co.uk/b" })]);
  assert.ok(c);
  assert.ok(c.reasons.length >= 2, "reasons answer 'why do we believe this'");
  assert.ok(c.confidence > 0 && c.confidence <= 1);
});

test("Wikipedia carries more weight than trade press", () => {
  const wiki = scoreCandidate([
    ev({ sourceUrl: null, sourceKind: "WIKIPEDIA", quality: 0.9 }),
    ev({ sourceUrl: "https://espn.com/a", quality: 0.9 }),
  ]);
  const trade = scoreCandidate([
    ev({ sourceUrl: "https://boxingnews24.com/a", quality: 0.9 }),
    ev({ sourceUrl: "https://eastsideboxing.com/b", quality: 0.9 }),
  ]);
  assert.ok(wiki && trade);
  assert.ok(wiki.confidence > trade.confidence);
});

test("DEFAULT_THRESHOLDS require corroboration", () => {
  assert.ok(DEFAULT_THRESHOLDS.autoPublishVoices >= 2, "one source must never be enough by default");
});
