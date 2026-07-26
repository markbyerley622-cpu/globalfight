import { test } from "node:test";
import assert from "node:assert/strict";
import { surfaceForms, matchKeys, translitKey, acronymOf } from "../forms";
import {
  candidate,
  textOnly,
  resolveName,
  mentionOf,
  mentionsIn,
  searchTerms,
  OPEN_SET_FLOOR,
  VIA_CONFIDENCE,
} from "../resolve";

// The entity layer is the accuracy floor for coverage, video matching and search,
// so its rules are pinned here rather than trusted. Every assertion below is a
// deterministic string comparison — if one breaks, a matching rule changed.

const AJ = (aliases: string[] = []) =>
  candidate("fighter", { id: "f_aj", slug: "anthony-joshua", name: "Anthony Joshua", aliases });

const FURY = () =>
  candidate("fighter", {
    id: "f_fury",
    slug: "tyson-fury",
    name: "Tyson Fury",
    nickname: "The Gypsy King",
  });

const PRENGA = () =>
  candidate("fighter", { id: "f_pr", slug: "kristian-prenga", name: "Kristian Prenga" });

const tierOf = (name: Parameters<typeof surfaceForms>[0], form: string) =>
  surfaceForms(name).find((f) => f.form === form)?.tier;

// ── surface forms ──────────────────────────────────────────────────────────

test("surfaceForms carries the canonical name and the surname", () => {
  assert.equal(tierOf({ name: "Anthony Joshua" }, "anthony joshua"), "canonical");
  assert.equal(tierOf({ name: "Anthony Joshua" }, "joshua"), "strong");
});

test("initials and acronyms are WEAK — legal only inside a closed set", () => {
  assert.equal(tierOf({ name: "Anthony Joshua" }, "aj"), "weak");
  assert.equal(tierOf({ name: "Anthony Joshua" }, "a joshua"), "weak");
});

test("a nickname is exposed with and without its leading article", () => {
  const forms = surfaceForms({ name: "Tyson Fury", nickname: "The Gypsy King" }).map((f) => f.form);
  assert.ok(forms.includes("the gypsy king"));
  assert.ok(forms.includes("gypsy king"));
});

test("a surname too short to be evidence is refused", () => {
  // "Li" would hit inside a hundred unrelated words.
  const forms = surfaceForms({ name: "Wang Li" }).map((f) => f.form);
  assert.ok(!forms.includes("li"));
});

test("registry aliases join the surface", () => {
  const forms = AJ(["Anthony Oluwafemi Joshua"]).forms.map((f) => f.form);
  assert.ok(forms.includes("anthony oluwafemi joshua"));
});

test("a collision keeps the STRONGEST tier and appears once", () => {
  const forms = surfaceForms({ name: "Kristian Prenga", nickname: "Prenga" });
  assert.equal(forms.filter((f) => f.form === "prenga").length, 1);
  assert.equal(forms.find((f) => f.form === "prenga")?.tier, "strong");
});

// ── transliteration ────────────────────────────────────────────────────────

test("translitKey collapses romanization variants of the same name", () => {
  assert.equal(translitKey("Aleksandr Volkov"), translitKey("Alexandr Volkov"));
  assert.equal(translitKey("Vladimir Klitschko"), translitKey("Wladimir Klitschko"));
  assert.equal(translitKey("Dmitri Bivol"), translitKey("Dmitry Bivol"));
  assert.equal(translitKey("Muhammad Mokaev"), translitKey("Muhamad Mokaev"));
});

test("translitKey does NOT collapse different names", () => {
  assert.notEqual(translitKey("Anthony Joshua"), translitKey("Anthony Yarde"));
  assert.notEqual(translitKey("Magomed Ankalaev"), translitKey("Magomed Bibulatov"));
});

test("acronymOf builds initials for 2–3 token names only", () => {
  assert.equal(acronymOf("anthony joshua"), "aj");
  assert.equal(acronymOf("georges st pierre"), "gsp");
  assert.equal(acronymOf("joshua"), null);
});

// ── name → entity ──────────────────────────────────────────────────────────

const pool = () => [AJ(["Anthony Oluwafemi Joshua"]), FURY(), PRENGA()];

test("resolveName takes the exact name at the top of the ladder", () => {
  const r = resolveName("Anthony Joshua", pool());
  assert.ok(r.ok);
  assert.equal(r.entity.id, "f_aj");
  assert.equal(r.via, "name_exact");
  assert.equal(r.confidence, VIA_CONFIDENCE.name_exact);
});

test("resolveName resolves a middle-name form to the same fighter", () => {
  const r = resolveName("Anthony Oluwafemi Joshua", pool());
  assert.ok(r.ok);
  assert.equal(r.entity.id, "f_aj");
});

test("resolveName resolves a nickname", () => {
  const r = resolveName("The Gypsy King", pool());
  assert.ok(r.ok);
  assert.equal(r.entity.id, "f_fury");
  assert.equal(r.via, "nickname");
});

test("resolveName resolves an initialled form inside a closed set", () => {
  const r = resolveName("A. Joshua", pool());
  assert.ok(r.ok);
  assert.equal(r.entity.id, "f_aj");
  assert.equal(r.via, "initial");
});

test("resolveName REFUSES the weak rungs in an open set", () => {
  const r = resolveName("A. Joshua", pool(), { openSet: true });
  assert.equal(r.ok, false);
  assert.ok(OPEN_SET_FLOOR > VIA_CONFIDENCE.initial);
});

test("resolveName reports AMBIGUOUS rather than guessing between equal hits", () => {
  const twins = [
    candidate("fighter", { id: "a", slug: "a", name: "Anthony Joshua" }),
    candidate("fighter", { id: "b", slug: "b", name: "Anthony Joshua" }),
  ];
  const r = resolveName("Anthony Joshua", twins);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "ambiguous");
    assert.equal(r.tied.length, 2);
  }
});

test("resolveName returns no_match for a name nobody shares", () => {
  const r = resolveName("Jon Jones", pool());
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "no_match");
});

test("resolveName accepts a romanization variant when it is unambiguous", () => {
  const r = resolveName("Vladimir Klitschko", [
    candidate("fighter", { id: "v", slug: "v", name: "Wladimir Klitschko" }),
    PRENGA(),
  ]);
  assert.ok(r.ok);
  assert.equal(r.entity.id, "v");
  assert.equal(r.via, "translit");
});

// ── text → entity ──────────────────────────────────────────────────────────

test("a headline surname is a TITLE hit", () => {
  assert.equal(mentionOf(AJ(), { title: "Joshua stops Prenga in three" })?.where, "title");
});

test("a nickname in a headline matches", () => {
  const m = mentionOf(FURY(), { title: "The Gypsy King eyes a return" });
  assert.equal(m?.where, "title");
  assert.equal(m?.form.origin, "nickname");
});

test("an acronym matches in a CLOSED set — the registry payoff", () => {
  const m = mentionOf(AJ(), { title: "AJ returns to the ring in September" });
  assert.equal(m?.where, "title");
  assert.equal(m?.form.origin, "acronym");
});

test("that same acronym is refused in an OPEN set", () => {
  assert.equal(
    mentionOf(AJ(), { title: "AJ returns to the ring in September" }, { openSet: true }),
    null,
  );
});

test("the title beats the body", () => {
  assert.equal(mentionOf(AJ(), { title: "Joshua wins", body: "Anthony Joshua won" })?.where, "title");
});

test("the body is used when the headline names nobody", () => {
  const m = mentionOf(AJ(), { title: "Big night in Manchester", body: "Anthony Joshua headlined" });
  assert.equal(m?.where, "body");
});

test("word boundaries hold — 'Fury' does not hit 'furious'", () => {
  assert.equal(mentionOf(FURY(), { title: "A furious finish in round two" }), null);
});

test("an article about a different card matches nobody", () => {
  assert.equal(mentionOf(PRENGA(), { title: "Ankalaev outpoints Guskov in Abu Dhabi" }), null);
});

test("mentionsIn finds every card fighter a headline names", () => {
  const found = mentionsIn([AJ(), FURY(), PRENGA()], { title: "Joshua vs Prenga confirmed" });
  assert.deepEqual(found.map((m) => m.entity.id).sort(), ["f_aj", "f_pr"]);
});

// ── query terms ────────────────────────────────────────────────────────────

test("searchTerms emits strong forms and EXCLUDES the weak ones", () => {
  const terms = searchTerms([AJ()]);
  assert.ok(terms.includes("anthony joshua"));
  assert.ok(terms.includes("joshua"));
  // A `contains '%aj%'` scan is the noise this layer removes, not reach it adds.
  assert.ok(!terms.includes("aj"));
  assert.ok(!terms.includes("a joshua"));
});

// ── honesty of the fallback ────────────────────────────────────────────────

test("textOnly marks a non-registry entity honestly", () => {
  const v = textOnly("venue", "The O2 Arena");
  assert.equal(v.id, null);
  assert.equal(v.via, "text_only");
  assert.ok(v.confidence < OPEN_SET_FLOOR);
});

test("matchKeys drops name suffixes so Jr/III forms unify", () => {
  assert.equal(matchKeys({ name: "Errol Spence Jr." }).canonical, "errol spence");
  assert.equal(matchKeys({ name: "Errol Spence" }).canonical, "errol spence");
});
