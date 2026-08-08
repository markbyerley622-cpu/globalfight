import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { rankByMatch, interleaveByRank } from "../server/rank";
import { entitySource, suggestableKinds } from "../server";
import { entityPlugin } from "../registry";

// ════════════════════════════════════════════════════════════════════════════
//  THE PICKER'S SERVER HALF.
//
//  ── What is genuinely tested here, and what is not ────────────────────────
//  The RANKING, the INTERLEAVING and the promotion suggester run for real:
//  ranking and interleaving are pure, and promotions live in an in-code
//  registry rather than a table, so `promotion.suggest` is exercised end to end
//  with no database at all.
//
//  The gym, fighter, event and mention suggesters issue SQL and cannot run
//  without Postgres. What is asserted about them here is their CONTRACT —
//  which is registered, what is suggestable versus merely resolvable — and
//  their ranking is covered through the shared helper they all call. Their
//  queries themselves are unverified locally, and the report says so.
// ════════════════════════════════════════════════════════════════════════════

describe("rankByMatch — the ladder every kind shares", () => {
  const rows = (...names: string[]) => names.map((name) => ({ name, alt: null as string | null }));
  const byName = (r: { name: string; alt: string | null }) => [r.name, r.alt];

  test("an EXACT match wins", () => {
    const out = rankByMatch(rows("Alexander Volkanovski", "Alex", "Alexa"), "alex", 3, byName);
    assert.equal(out[0].name, "Alex");
  });

  test("a PREFIX beats a mid-word match", () => {
    const out = rankByMatch(rows("Not Alex Here", "Alexa Grasso"), "alex", 2, byName);
    assert.equal(out[0].name, "Alexa Grasso");
  });

  test("a WORD-START beats a match buried mid-token", () => {
    // "pereira" should find "Alex Pereira" ahead of a name that merely contains
    // the letters inside a longer word.
    const out = rankByMatch(rows("Xpereirax Smith", "Alex Pereira"), "pereira", 2, byName);
    assert.equal(out[0].name, "Alex Pereira");
  });

  test("a SECONDARY field matches, but never beats a primary prefix", () => {
    const list = [
      { name: "Something Else", alt: "Poatan" },   // secondary exact
      { name: "Poatanic Gym", alt: null },          // primary prefix
    ];
    const out = rankByMatch(list, "poatan", 2, (r) => [r.name, r.alt]);
    assert.equal(out[0].name, "Poatanic Gym", "a secondary exact outranked a primary prefix");
    assert.equal(out[1].name, "Something Else", "the secondary match was dropped entirely");
  });

  test("ties keep the INCOMING order, so results do not shuffle between keystrokes", () => {
    // The incoming order is the database's own ranking (verified, then
    // popularity). A ranker that reordered equal matches would make a row jump
    // position as the query grows, which reads as the list flickering.
    const out = rankByMatch(rows("Zed Team", "Alpha Team"), "team", 2, byName);
    assert.deepEqual(out.map((r) => r.name), ["Zed Team", "Alpha Team"]);
  });

  test("the limit is a CEILING, not a hint", () => {
    assert.equal(rankByMatch(rows("a1", "a2", "a3", "a4", "a5"), "a", 3, byName).length, 3);
  });

  test("accented and non-Latin names rank without throwing", () => {
    const out = rankByMatch(rows("José Aldo", "Хабиб Нурмагомедов"), "josé", 2, byName);
    assert.equal(out[0].name, "José Aldo");
    // And a query in another script still resolves rather than erroring.
    assert.equal(rankByMatch(rows("Хабиб Нурмагомедов"), "хабиб", 1, byName).length, 1);
  });
});

describe("interleaveByRank — every kind that matched stays visible", () => {
  test("one from each kind, then the seconds", () => {
    const merged = interleaveByRank([["p1", "p2", "p3"], ["f1", "f2"], ["e1"]], 10);
    assert.deepEqual(merged, ["p1", "f1", "e1", "p2", "f2", "p3"]);
  });

  test("no single kind can fill the menu", () => {
    // The case this exists for: "ufc" matches dozens of events and exactly one
    // promotion. Concatenation would bury the promotion; round-robin cannot.
    const events = Array.from({ length: 20 }, (_, i) => `e${i}`);
    const merged = interleaveByRank([events, ["ufc-promotion"]], 5);
    assert.ok(merged.includes("ufc-promotion"), "a one-result kind was crowded out");
  });

  test("the total limit is respected exactly", () => {
    const merged = interleaveByRank([["a", "b", "c"], ["d", "e", "f"]], 4);
    assert.equal(merged.length, 4);
  });

  test("empty kinds cost the others nothing", () => {
    const merged = interleaveByRank([[], ["a", "b"], [], ["c"]], 10);
    assert.deepEqual(merged, ["a", "c", "b"]);
  });

  test("nothing at all is an empty list, not a crash", () => {
    assert.deepEqual(interleaveByRank([], 10), []);
    assert.deepEqual(interleaveByRank([[], []], 10), []);
  });

  test("group ORDER follows first appearance, not the input order", () => {
    // The client renders headings in order of first appearance, so this is what
    // decides them. An event-led result set must put Events first WITHOUT any
    // caller reordering the lists.
    const merged = interleaveByRank([[], [], ["e1", "e2"], ["p1"]], 10);
    assert.equal(merged[0], "e1", "the first result did not come from the kind that matched");
  });
});

describe("promotions suggest for real — no database involved", () => {
  const source = entitySource("promotion")!;
  const suggest = (q: string, limit = 5) => source.suggest!(q, limit, { viewerId: null });

  test("a promotion is found by NAME", async () => {
    const out = await suggest("ufc");
    assert.ok(out.length > 0, "no promotion matched 'ufc'");
    assert.ok(out.some((s) => s.key === "ufc"), "UFC itself was not returned");
  });

  test("it is found by ALIAS, but always DISPLAYS its canonical name", async () => {
    // The registry's aliases are the point: somebody typing what they call the
    // org still finds it. What gets inserted must not vary with the alias used,
    // or the stored span would differ between two people meaning the same org.
    const out = await suggest("ultimate fighting");
    const ufc = out.find((s) => s.key === "ufc");
    assert.ok(ufc, "an alias did not match");
    assert.equal(ufc.insert, "UFC");
    assert.equal(ufc.title, "UFC");
  });

  test("the client gets a SLUG, never a database id", async () => {
    const out = await suggest("ufc");
    for (const s of out) {
      assert.match(s.key, /^[a-z0-9-]+$/, `key "${s.key}" does not look like a public slug`);
      assert.ok(!("id" in s), "a suggestion carried an id field");
    }
  });

  test("the NEUTRAL FALLBACK org is never offered", async () => {
    // "Multiple promotions" is the placeholder synthesised for events whose
    // source names no organiser. Offering it would put it in front of a reader
    // as though it were a real promotion.
    for (const q of ["multiple", "combat", "various"]) {
      const out = await suggest(q, 20);
      assert.ok(
        !out.some((s) => s.key === "combat"),
        `the fallback org was suggested for "${q}"`,
      );
    }
  });

  test("an empty query offers nothing — a picker is not a directory", async () => {
    assert.deepEqual(await suggest(""), []);
  });

  test("the limit is respected", async () => {
    // A single letter matches many aliases; the cap must still hold.
    const out = await suggest("a", 3);
    assert.ok(out.length <= 3, `returned ${out.length} for a limit of 3`);
  });

  test("a query matching nothing returns nothing, quietly", async () => {
    assert.deepEqual(await suggest("zzzzzznotapromotion"), []);
  });

  test("the inserted text is what `resolve` will expect", async () => {
    // The contract between the two halves: the picker inserts `@<insert>` and
    // resolve requires the span to read `@<name>`. If these ever diverge, every
    // selection silently degrades to plain text — the span check would reject
    // a pick the user made correctly.
    const out = await suggest("ufc");
    const picked = out.find((s) => s.key === "ufc")!;
    const resolved = await source.resolve([picked.key], { viewerId: null });
    assert.equal(resolved.get(picked.key)?.expect, `@${picked.insert}`);
  });
});

describe("gym and promotion are SUGGESTABLE, not merely resolvable", () => {
  test("both implement the optional suggest contract", () => {
    for (const kind of ["gym", "promotion"]) {
      const source = entitySource(kind);
      assert.ok(source, `${kind} has no entity source`);
      assert.equal(
        typeof source.suggest, "function",
        `${kind} is resolvable but not suggestable — it would never appear in the picker`,
      );
    }
  });

  test("suggestableKinds now reports all five", () => {
    const kinds = suggestableKinds().sort();
    assert.deepEqual(kinds, ["event", "fighter", "gym", "mention", "promotion"]);
  });

  test("every suggestable kind can also be rendered and navigated", () => {
    // Suggesting a kind the renderer cannot draw would let somebody pick
    // something that stores fine and then appears as plain text.
    for (const kind of suggestableKinds()) {
      const plugin = entityPlugin(kind);
      assert.ok(plugin, `${kind} is suggestable but has no plugin`);
      assert.ok(plugin.labelPlural.length > 0, `${kind} has no group heading for the picker`);
      assert.equal(typeof plugin.href, "function", `${kind} has no navigation`);
    }
  });

  test("every suggestable kind can also RESOLVE what it suggested", () => {
    // A kind that could be offered but not stored would be a dead end that
    // looks like it worked until the post was sent.
    for (const kind of suggestableKinds()) {
      const source = entitySource(kind)!;
      assert.equal(typeof source.resolve, "function", `${kind} cannot resolve`);
      assert.equal(typeof source.hydrate, "function", `${kind} cannot hydrate`);
    }
  });
});
