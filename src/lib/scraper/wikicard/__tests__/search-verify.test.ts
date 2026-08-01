import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchLadder, isSyntheticEventName, coreEventTitle } from "../search-strategies";
import { verifyCard, isAcceptable } from "../verify";
import { candidate } from "@/lib/entities/resolve";
import type { WikiBout } from "../extract";

// The conflation these two modules exist to break: one field was used both to
// identify the event in OUR database and to query Wikipedia. A synthetic card's name
// cannot be found upstream, so 1,754 bouts were unreachable. Search is now loose and
// acceptance is strict — these tests pin both halves, because loosening the query
// without tightening acceptance would write the wrong fighter's result.

const ent = (id: string, name: string, extra: { nickname?: string; aliases?: string[] } = {}) =>
  candidate("fighter", { id, slug: id, name, ...extra });

const SPENCE = ent("f_spence", "Errol Spence Jr");
const TSZYU = ent("f_tszyu", "Tim Tszyu");
const FURY = ent("f_fury", "Tyson Fury", { nickname: "The Gypsy King" });
const WACH = ent("f_wach", "Mariusz Wach");

const bout = (red: string, blue: string, over: Partial<WikiBout> = {}): WikiBout => ({
  weightClass: null, ruleset: null, redName: red, blueName: blue,
  decided: true, method: "TKO", round: 9, time: null, titleFight: false, ...over,
});

// ── synthetic detection ─────────────────────────────────────────────────────

test("the odds pipeline's daily cards are recognised as synthetic containers", () => {
  assert.equal(isSyntheticEventName("Boxing — 26 Jul 2026"), true);
  assert.equal(isSyntheticEventName("MMA — 25 Jul 2026"), true);
  assert.equal(isSyntheticEventName("Bare Knuckle — 01 Jan 2027"), true);
  // Hyphen instead of an em dash — the separator is formatting, not a contract.
  assert.equal(isSyntheticEventName("Boxing - 26 Jul 2026"), true);
});

test("real promotion cards are NOT treated as synthetic", () => {
  for (const n of ["BKFC 91", "ONE Fight Night 39", "UFC 300", "Judo at the 2026 Commonwealth Games"]) {
    assert.equal(isSyntheticEventName(n), false, n);
  }
});

// ── the ladder ──────────────────────────────────────────────────────────────

test("a synthetic card does NOT waste a query on its own unfindable name", () => {
  const ladder = buildSearchLadder({
    eventName: "Boxing — 26 Jul 2026",
    promotionName: null,
    bouts: [{ red: SPENCE, blue: TSZYU }],
  });
  assert.ok(!ladder.some((s) => s.kind === "event_title"), "no source indexes a synthetic name");
  // It is found by its BOUT — the fix.
  assert.equal(ladder[0].kind, "main_bout");
  assert.equal(ladder[0].query, "Errol Spence Jr vs Tim Tszyu");
});

test("a real event leads with its own title, so it resolves in ONE query", () => {
  const ladder = buildSearchLadder({
    eventName: "BKFC 91",
    promotionName: "BKFC",
    bouts: [{ red: SPENCE, blue: TSZYU }],
  });
  assert.equal(ladder[0].kind, "event_title");
  assert.equal(ladder[0].query, "BKFC 91");
  // "BKFC BKFC 91" is not added — the name already carries the promotion. See the
  // query-hygiene tests below.
  assert.ok(!ladder.some((s) => s.kind === "promotion_event"));
});

// ── event-title reduction (for the year-page splitter, NOT for search) ──────
//
// A promotion names its card for the billing:
//   "ONE Friday Fights 164 & The Inner Circle 24"          two events, one night
//   "ONE Fight Night 45: Lessei vs. Rabah on Prime Video"    distribution suffix
// and upstream punctuates the same compound with "/" instead of "&". Reduction
// lets a year-page section be matched back to our event row across that skew.
//
// It is deliberately NOT a ladder rung: probed 2026-08-02, the full title, the
// reduced title and both Prime Video forms all return the same upstream hit
// ("2026 in ONE Championship"), so a rung would spend a request to re-ask an
// answered question. The pin below is what keeps that from being re-added.

test("a co-branded double card is reduced to the numbered event", () => {
  assert.equal(coreEventTitle("ONE Friday Fights 164 & The Inner Circle 24"), "ONE Friday Fights 164");
  // Upstream's punctuation of the same fact.
  assert.equal(
    coreEventTitle("ONE Friday Fights 163: Pompet vs. Nat Khat Min / The Inner Circle 23"),
    "ONE Friday Fights 163: Pompet vs. Nat Khat Min",
  );
});

test("a trailing distribution note is not part of the card's identity", () => {
  assert.equal(coreEventTitle("ONE Friday Fights 138 (YouTube / Watch ONE)"), "ONE Friday Fights 138");
});

test("a broadcast suffix is not part of the event's indexed name", () => {
  assert.equal(
    coreEventTitle("ONE Fight Night 45: Lessei vs. Rabah on Prime Video"),
    "ONE Fight Night 45: Lessei vs. Rabah",
  );
  assert.equal(coreEventTitle("ONE Fight Night 20 live on Amazon Prime Video"), "ONE Fight Night 20");
  assert.equal(coreEventTitle("Misfits Boxing 15 presented by DAZN"), "Misfits Boxing 15");
});

test("a title already in its indexed form yields no second query", () => {
  for (const n of ["BKFC 91", "UFC 300", "ONE Fight Night 39"]) {
    assert.equal(coreEventTitle(n), null, n);
  }
});

test("an ampersand that is part of the name is never truncated away", () => {
  // No digit on the left, so there is no numbered card to fall back to — splitting
  // here would invent a different event, which is worse than not matching.
  assert.equal(coreEventTitle("Rock & Roll Rumble"), null);
  assert.equal(coreEventTitle("Tag & Team Championship"), null);
});

test("reduction does NOT become a search rung — the probe showed it buys nothing", () => {
  const ladder = buildSearchLadder({
    eventName: "ONE Friday Fights 164 & The Inner Circle 24",
    promotionName: "ONE Championship",
    bouts: [{ red: SPENCE, blue: TSZYU }],
  });
  // The stored name is asked once, verbatim. The reduced form is a MATCHING key
  // for the year-page splitter, not a second question for the source.
  assert.equal(ladder[0].query, "ONE Friday Fights 164 & The Inner Circle 24");
  assert.ok(!ladder.some((s) => s.query === "ONE Friday Fights 164"));
});

test("the ladder is ordered, deduped and includes the fallback sweeps", () => {
  const ladder = buildSearchLadder({
    eventName: "BKFC 91",
    promotionName: "BKFC",
    bouts: [{ red: FURY, blue: WACH }],
  });
  const kinds = ladder.map((s) => s.kind);
  assert.deepEqual([...new Set(kinds)], kinds.filter((k, i) => kinds.indexOf(k) === i));
  assert.ok(kinds.includes("fighter_names"));
  // Nickname reaches the ladder via Entity Resolution — a fighter indexed under
  // their ring name is reachable here and nowhere else.
  const alias = ladder.find((s) => s.kind === "alias_bout");
  assert.ok(alias, "a nickname should produce an alias query");
  assert.match(alias!.query, /gypsy king/i);
});

test("a registry ALIAS produces a query", () => {
  const aj = ent("f_aj", "Anthony Joshua", { aliases: ["Anthony Oluwafemi Joshua"] });
  const ladder = buildSearchLadder({
    eventName: "Boxing — 25 Jul 2026",
    promotionName: null,
    bouts: [{ red: aj, blue: ent("f_pr", "Kristian Prenga") }],
  });
  const alias = ladder.find((s) => s.kind === "alias_bout");
  assert.ok(alias);
  assert.match(alias!.query, /oluwafemi/i);
});

test("no bouts and a synthetic name yields an EMPTY ladder — nothing findable", () => {
  // Emitting a target here would spend a request to learn nothing.
  const ladder = buildSearchLadder({ eventName: "Boxing — 26 Jul 2026", promotionName: null, bouts: [] });
  assert.equal(ladder.length, 0);
});

test("weak forms never become queries", () => {
  // "AJ vs Prenga" would return noise; acronyms are for scoring a candidate we
  // already hold, never for widening the search that produced it.
  const aj = ent("f_aj", "Anthony Joshua");
  const ladder = buildSearchLadder({
    eventName: "Boxing — 25 Jul 2026",
    promotionName: null,
    bouts: [{ red: aj, blue: ent("f_pr", "Kristian Prenga") }],
  });
  for (const s of ladder) assert.ok(!/\baj\b/i.test(s.query), `weak form leaked: ${s.query}`);
});

// ── verification: the strict half ───────────────────────────────────────────

test("a page whose card contains our bout VERIFIES", () => {
  const m = verifyCard([bout("Errol Spence Jr", "Tim Tszyu")], [{ red: SPENCE, blue: TSZYU }]);
  assert.equal(m.matched, 1);
  assert.equal(isAcceptable(m), true);
});

test("verification tolerates the source's spelling — Entity Resolution does the matching", () => {
  const m = verifyCard(
    [bout("Errol Spence Jr.", "Tim Tszyu")], // trailing dot
    [{ red: SPENCE, blue: TSZYU }],
  );
  assert.equal(isAcceptable(m), true);
});

test("a page about DIFFERENT fighters is REJECTED — this is what makes a loose query safe", () => {
  const m = verifyCard(
    [bout("Terence Crawford", "Israil Madrimov")],
    [{ red: SPENCE, blue: TSZYU }],
  );
  assert.equal(m.matched, 0);
  assert.equal(isAcceptable(m), false);
});

test("ONE matching name is not a bout — both corners must resolve to the same pair", () => {
  // Spence appears on many cards; a page naming him against someone else is not ours.
  const m = verifyCard(
    [bout("Errol Spence Jr", "Terence Crawford")],
    [{ red: SPENCE, blue: TSZYU }],
  );
  assert.equal(isAcceptable(m), false);
});

test("corner order does not matter to verification", () => {
  const m = verifyCard([bout("Tim Tszyu", "Errol Spence Jr")], [{ red: SPENCE, blue: TSZYU }]);
  assert.equal(isAcceptable(m), true);
});

test("a real card verifies on the one bout we needed and reports the whole card", () => {
  const m = verifyCard(
    [
      bout("Some Headliner", "Another Fighter"),
      bout("Errol Spence Jr", "Tim Tszyu"),
      bout("Third Guy", "Fourth Guy"),
    ],
    [{ red: SPENCE, blue: TSZYU }],
  );
  assert.equal(m.matched, 1);
  assert.equal(m.parsed, 3, "the full card is still persisted");
  assert.equal(isAcceptable(m), true);
});

test("an empty card or no expected bouts never verifies", () => {
  assert.equal(isAcceptable(verifyCard([], [{ red: SPENCE, blue: TSZYU }])), false);
  assert.equal(isAcceptable(verifyCard([bout("A B", "C D")], [])), false);
});

test("a parse artefact resolving both corners to one fighter is rejected", () => {
  const m = verifyCard([bout("Errol Spence Jr", "Errol Spence Jr")], [{ red: SPENCE, blue: TSZYU }]);
  assert.equal(isAcceptable(m), false);
});

// ── query hygiene: every request costs someone else's rate limit ─────────────

test("a SLUG-shaped alias never becomes a query when it just restates the name", () => {
  // Registry aliases are recorded from whatever upstream supplied; some are slugs.
  // "magomed-ankalaev vs Bogdan Guskov" finds nothing and costs a request — and in a
  // historical repair that is multiplied by the whole backlog.
  const ank = ent("f_ank", "Magomed Ankalaev", { aliases: ["magomed-ankalaev"] });
  const ladder = buildSearchLadder({
    eventName: "Magomed Ankalaev vs Bogdan Guskov",
    promotionName: null,
    bouts: [{ red: ank, blue: ent("f_gus", "Bogdan Guskov") }],
  });
  for (const s of ladder) assert.ok(!/-/.test(s.query), `slug leaked into a query: ${s.query}`);
  assert.ok(!ladder.some((s) => s.kind === "alias_bout"), "a slug of the same name adds nothing");
});

test("a slug-shaped alias of a DIFFERENT name is de-slugified and kept", () => {
  const aj = ent("f_aj", "Anthony Joshua", { aliases: ["anthony-oluwafemi-joshua"] });
  const ladder = buildSearchLadder({
    eventName: "Boxing — 25 Jul 2026",
    promotionName: null,
    bouts: [{ red: aj, blue: ent("f_pr", "Kristian Prenga") }],
  });
  const alias = ladder.find((s) => s.kind === "alias_bout");
  assert.ok(alias, "a genuinely different alias is still worth a query");
  assert.equal(alias!.query, "anthony oluwafemi joshua vs Kristian Prenga");
});

test("promotion_event is skipped when the event name already carries the promotion", () => {
  // "UFC UFC: Topuria vs Tsarukyan" is a wasted request.
  const ladder = buildSearchLadder({
    eventName: "UFC: Topuria vs Tsarukyan",
    promotionName: "UFC",
    bouts: [{ red: ent("a", "Ilia Topuria"), blue: ent("b", "Arman Tsarukyan") }],
  });
  assert.ok(!ladder.some((s) => s.kind === "promotion_event"), ladder.map((s) => s.query).join(" | "));
});

test("promotion_event IS added when the event name is a bare number", () => {
  const ladder = buildSearchLadder({
    eventName: "91",
    promotionName: "BKFC",
    bouts: [{ red: ent("a", "Mike Perry"), blue: ent("b", "Eddie Alvarez") }],
  });
  assert.ok(ladder.some((s) => s.kind === "promotion_event" && s.query === "BKFC 91"));
});
