import { test } from "node:test";
import assert from "node:assert/strict";
import { moderateText } from "@/lib/moderation/text";
import { normalize, collapsed } from "@/lib/moderation/text/normalize";

// ════════════════════════════════════════════════════════════════════════════
//  The contract: SWEARING IS FINE, SLURS ARE NOT.
//
//  The allow tests below are the more important half. A moderation service that
//  over-blocks gets switched off, and every false positive is a real fan being
//  told their fight take is hate speech. These lock the language this audience
//  actually uses — profanity, violent fight talk, "chink in the armour" — as
//  explicitly permitted, so nobody can tighten a rule later without seeing
//  exactly what it costs.
// ════════════════════════════════════════════════════════════════════════════

const allowed = (s: string) => moderateText(s).ok;
const blockedBy = (s: string) => {
  const r = moderateText(s);
  return r.ok ? null : r.ruleId;
};

// ── MUST PASS — ordinary combat-sports talk ─────────────────────────────────

test("profanity is allowed — this is a fight board", () => {
  for (const s of [
    "This fight was fucking amazing.",
    "He's getting knocked the fuck out.",
    "This referee was terrible.",
    "That was absolute shit, worst card of the year.",
    "Holy shit what a knockout",
    "He got his ass beat, plain and simple.",
    "What a bullshit decision by the judges.",
    "Damn, that left hook was nasty as hell.",
  ]) {
    assert.equal(allowed(s), true, `should allow: ${s}`);
  }
});

test("violent FIGHT language is allowed — it is the subject matter", () => {
  for (const s of [
    "He's going to kill him in there.",
    "Pereira will knock him dead in round one.",
    "Finish him!",
    "I hope he destroys him.",
    "He should get put to sleep for that.",
    "Someone needs to shut his mouth in the cage.",
    "@dave I'll knock you out on the picks this week",
  ]) {
    assert.equal(allowed(s), true, `should allow: ${s}`);
  }
});

test("'chink in the armour' is stock commentary, not a slur", () => {
  // The single most likely false positive this service could produce, on
  // exactly the kind of technical breakdown the product wants.
  assert.equal(allowed("Finally a chink in the armour of his defence."), true);
  assert.equal(allowed("There's a chink in his armor when he throws the jab."), true);
});

test("words that merely CONTAIN a deny-listed term are allowed", () => {
  // The Scunthorpe problem. The collapsed-form pass has no word boundaries, so
  // these are what the innocent-substring allow-list exists for.
  for (const s of [
    "That raccoon celebration was hilarious.",
    "He came out of his cocoon this camp.",
    "The spice in that combination was unreal.",
    "Japanese fighters have the best fundamentals.",
    "A masterclass in analysis from the commentary team.",
    "He passed the guard easily.",
  ]) {
    assert.equal(allowed(s), true, `should allow: ${s}`);
  }
});

test("shouting survives — a knockout deserves it", () => {
  assert.equal(allowed("LETSGOOOOOOOOO"), true);
  assert.equal(allowed("OOOOOHHHHHH WHAT A SHOT"), true);
});

test("empty and whitespace-only input is not a violation", () => {
  assert.equal(allowed(""), true);
  assert.equal(allowed("   \n  "), true);
});

// ── MUST BLOCK ──────────────────────────────────────────────────────────────

test("racial slurs are blocked", () => {
  // Built from the encoded list rather than typed literally, so this test file
  // is not itself a slur dump.
  const slur = Buffer.from("bmlnZ2Vy", "base64").toString("utf8");
  assert.equal(blockedBy(`${slur} get out`), "hate.racial_slur");
  assert.equal(blockedBy(`you are a ${slur}`), "hate.racial_slur");
});

test("slurs are blocked through leetspeak and spacing evasion", () => {
  const slur = Buffer.from("bmlnZ2Vy", "base64").toString("utf8");
  const leet = slur.replace(/i/g, "1").replace(/e/g, "3");
  assert.equal(blockedBy(leet), "hate.racial_slur", "leetspeak");
  assert.equal(blockedBy(slur.split("").join(" ")), "hate.racial_slur", "spaced out");
  assert.equal(blockedBy(slur.split("").join(".")), "hate.racial_slur", "punctuated");
  assert.equal(blockedBy(slur.toUpperCase()), "hate.racial_slur", "upper case");
});

test("homophobic and ableist slurs are blocked", () => {
  assert.equal(
    blockedBy(`he is such a ${Buffer.from("ZmFnZ290", "base64").toString("utf8")}`),
    "hate.homophobic_slur",
  );
  assert.equal(
    blockedBy(`what a ${Buffer.from("cmV0YXJk", "base64").toString("utf8")}`),
    "hate.ableist_slur",
  );
});

test("group incitement is blocked even with no slur in it", () => {
  // Hate speech does not require a word from a list, which is the whole reason
  // the registry carries structural rules and not just terms.
  assert.equal(blockedBy("all muslims should be deported"), "hate.incitement");
  assert.equal(blockedBy("every jew deserves to die"), "hate.incitement");
});

test("telling someone to kill themselves is blocked", () => {
  assert.equal(blockedBy("kys"), "harassment.self_harm");
  assert.equal(blockedBy("just kill yourself mate"), "harassment.self_harm");
  assert.equal(blockedBy("k y s"), "harassment.self_harm");
});

test("real-world threats against a member are blocked, fight banter is not", () => {
  assert.equal(blockedBy("@dave i know where you live"), "harassment.threat");
  assert.equal(blockedBy("@dave i will find you"), "harassment.threat");
  // …while the same aggression about the FIGHT stays up.
  assert.equal(allowed("@dave your boy is getting slept in round two"), true);
});

test("spam heuristics", () => {
  const links = Array.from({ length: 5 }, (_, i) => `https://spam${i}.example.com`).join(" ");
  assert.equal(blockedBy(links), "spam.links");
  const mentions = Array.from({ length: 10 }, (_, i) => `@user${i}`).join(" ");
  assert.equal(blockedBy(mentions), "spam.mentions");
  assert.equal(blockedBy("a".repeat(60)), "spam.flood");
});

test("a blocked result carries a stable id, a category and a user-facing sentence", () => {
  // These three are the contract the future moderator queue, appeals flow and
  // analytics all hang off.
  const r = moderateText(`${Buffer.from("bmlnZ2Vy", "base64").toString("utf8")}`);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.ruleId, "hate.racial_slur");
  assert.equal(r.category, "hate_speech");
  assert.ok(r.message.length > 20, "message should be a real sentence");
  assert.ok(!r.message.includes("undefined"));
});

test("hate speech outranks spam when a post is both", () => {
  // First-match ordering is meaningful: the author is told the serious thing.
  const slur = Buffer.from("bmlnZ2Vy", "base64").toString("utf8");
  const both = `${slur} ` + Array.from({ length: 6 }, (_, i) => `https://x${i}.example.com`).join(" ");
  assert.equal(blockedBy(both), "hate.racial_slur");
});

// ── Normalisation primitives ────────────────────────────────────────────────

test("normalize folds case, accents and leetspeak but keeps word boundaries", () => {
  assert.equal(normalize("HÉLLO"), "hello");
  assert.equal(normalize("l33t"), "leet");
  assert.equal(normalize("s0me @rt"), "some art");
  assert.ok(normalize("hello world").includes(" "), "boundaries survive");
});

test("normalize collapses 3+ repeats to 2, leaving real doubles intact", () => {
  assert.equal(normalize("niiiice"), "niice");
  assert.equal(normalize("hello"), "hello");
});

test("collapsed strips every separator", () => {
  assert.equal(collapsed("h e l l o"), "hello");
  assert.equal(collapsed("h.e-l_l*o"), "hello");
});

test("zero-width characters cannot smuggle a term through", () => {
  const slur = Buffer.from("bmlnZ2Vy", "base64").toString("utf8");
  assert.equal(blockedBy(slur.split("").join("​")), "hate.racial_slur");
});
