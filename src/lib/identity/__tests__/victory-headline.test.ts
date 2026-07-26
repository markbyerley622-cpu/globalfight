import { test } from "node:test";
import assert from "node:assert/strict";
import { predictionHeadline, socialProofLine, methodFamily, type CardFacts } from "../victory-headline";

// The Victory Card's headline is the thing a user reads before deciding to post.
// It must never claim something the pick doesn't support — an inflated headline
// on a shared card is a public credibility risk for the user AND the product.

const facts = (over: Partial<CardFacts> = {}): CardFacts => ({
  correct: true,
  calledByPct: 50,
  crowdTotal: 100,
  confidence: 3,
  resultMethod: null,
  calledMethod: null,
  streak: null,
  titleFight: false,
  ...over,
});

// ── methodFamily ────────────────────────────────────────────────────────────

test("methodFamily collapses the granular enum", () => {
  assert.equal(methodFamily("KO"), "KO");
  assert.equal(methodFamily("TKO"), "KO");
  assert.equal(methodFamily("SUB"), "SUB");
  assert.equal(methodFamily("RTD"), "SUB");
  assert.equal(methodFamily("UD"), "DEC");
  assert.equal(methodFamily("SD"), "DEC");
  assert.equal(methodFamily("DQ"), null, "not a called-able finish");
  assert.equal(methodFamily(null), null);
});

// ── priority order ──────────────────────────────────────────────────────────

test("rare contrarian correct call quotes the exact %", () => {
  const h = predictionHeadline(facts({ calledByPct: 8, crowdTotal: 200 }));
  assert.equal(h.text, "Only 8% saw it coming.");
  assert.equal(h.kind, "win");
});

test("upset call (<=33%) beats streak and confidence", () => {
  const h = predictionHeadline(facts({ calledByPct: 25, streak: 9, confidence: 5 }));
  assert.equal(h.text, "You called the upset.");
});

test("a small crowd never quotes a % — quorum guard", () => {
  // 8% of 5 picks is noise about strangers, not a signal.
  const h = predictionHeadline(facts({ calledByPct: 8, crowdTotal: 5, confidence: 3 }));
  assert.notEqual(h.text, "Only 8% saw it coming.");
  assert.equal(h.text, "Called it.");
});

test("5+ streak is its own headline when no upset applies", () => {
  assert.equal(predictionHeadline(facts({ calledByPct: 60, streak: 6 })).text, "6-fight win streak.");
});

test("3-4 streak → Another one.", () => {
  assert.equal(predictionHeadline(facts({ calledByPct: 60, streak: 3 })).text, "Another one.");
});

test("called the finish requires BOTH method match and confidence", () => {
  assert.equal(
    predictionHeadline(facts({ calledByPct: 55, resultMethod: "KO", calledMethod: "KO", confidence: 5 })).text,
    "Called the finish.",
  );
  // right method, low confidence → not "the finish", falls through to default
  assert.equal(
    predictionHeadline(facts({ calledByPct: 55, resultMethod: "KO", calledMethod: "KO", confidence: 2 })).text,
    "Called it.",
  );
  // called SUB, ended KO → no finish claim
  assert.equal(
    predictionHeadline(facts({ calledByPct: 55, resultMethod: "KO", calledMethod: "SUB", confidence: 5 })).text,
    "Perfect call.",
  );
});

test("high confidence correct call → Perfect call.", () => {
  assert.equal(predictionHeadline(facts({ calledByPct: 55, confidence: 5 })).text, "Perfect call.");
});

test("title fight correct call, nothing rarer → Called the title.", () => {
  assert.equal(predictionHeadline(facts({ calledByPct: 55, confidence: 3, titleFight: true })).text, "Called the title.");
});

test("plain correct call → Called it.", () => {
  assert.equal(predictionHeadline(facts({ calledByPct: 55, confidence: 3 })).text, "Called it.");
});

// ── losses are honest and never mocking ──────────────────────────────────────

test("a miss is a loss headline, not a taunt", () => {
  const h = predictionHeadline(facts({ correct: false, calledByPct: 40 }));
  assert.equal(h.kind, "loss");
  assert.equal(h.text, "The other corner took it.");
});

test("a confident miss is acknowledged as backed hard", () => {
  const h = predictionHeadline(facts({ correct: false, confidence: 5, streak: 0 }));
  assert.equal(h.text, "Backed it hard. Didn't land.");
});

// ── social proof is always a true statement ──────────────────────────────────

test("social proof: beat the share who picked wrong", () => {
  assert.equal(socialProofLine(facts({ correct: true, calledByPct: 30 })), "You beat 70% of callers on this one.");
});

test("social proof: consensus win stated honestly, not spun", () => {
  assert.equal(socialProofLine(facts({ correct: true, calledByPct: 80 })), "80% of callers had it too.");
});

test("social proof: suppressed below quorum", () => {
  assert.equal(socialProofLine(facts({ correct: true, calledByPct: 10, crowdTotal: 4 })), null);
});

test("social proof on a miss reports the crowd honestly", () => {
  assert.equal(socialProofLine(facts({ correct: false, calledByPct: 45 })), "45% of callers took the same corner.");
});
