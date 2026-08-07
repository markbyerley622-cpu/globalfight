import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWba, parseWbaFemale, validateWba } from "../connectors/wba";

// Fixture mirrors the real WBA female page shape: a <span>DIVISION</span> header
// before each table; a champion table flagged "WBA WORLD CHAMPION" and a
// contenders table with `rank · name · country`.
const FIXTURE = `
<div>
  <span class="hdr">HEAVYWEIGHT</span>
  <table><tr><td></td><td>CLARESSA SHIELDS USA</td><td>WBA WORLD CHAMPION</td></tr></table>
  <span class="hdr">HEAVYWEIGHT</span>
  <table>
    <tr><td>1</td><td>NOT RATED</td></tr>
    <tr><td>2</td><td>MINELLIS BLANCO</td><td></td><td>COL</td></tr>
    <tr><td>3</td><td>ANNIE MAZEROLLE</td><td></td><td>CAN</td></tr>
  </table>
  <span class="hdr">SUPER LIGHTWEIGHT</span>
  <table><tr><td></td><td>CHANTELLE CAMERON GBR</td><td>WBA WORLD CHAMPION</td></tr></table>
  <span class="hdr">SUPER LIGHTWEIGHT</span>
  <table>
    <tr><td>1</td><td>KYLIE EPPERSON</td><td></td><td>USA</td></tr>
  </table>
</div>`;

const at = new Date("2026-07-24T00:00:00Z");

test("parses champions as rank 0 with country", () => {
  const rows = parseWbaFemale(FIXTURE, at);
  const champ = rows.find((r) => r.rank === 0 && r.weightClass === "Women's Heavyweight");
  assert.ok(champ, "heavyweight champion present");
  assert.equal(champ!.name, "CLARESSA SHIELDS");
  assert.equal(champ!.countryCode, "US");
  assert.equal(champ!.organisation, "WBA");
  assert.equal(champ!.gender, "female");
});

test("parses contenders and drops NOT RATED", () => {
  const rows = parseWbaFemale(FIXTURE, at);
  const hw = rows.filter((r) => r.weightClass === "Women's Heavyweight" && r.rank >= 1);
  assert.deepEqual(hw.map((r) => [r.rank, r.name]), [
    [2, "MINELLIS BLANCO"],
    [3, "ANNIE MAZEROLLE"],
  ]);
  assert.equal(hw[0].countryCode, "CO");
});

test("normalizes division labels and carries them across the pair", () => {
  const rows = parseWbaFemale(FIXTURE, at);
  assert.ok(rows.some((r) => r.weightClass === "Women's Super Lightweight" && r.name === "KYLIE EPPERSON"));
  // every row is tagged with a real division, never blank
  assert.ok(rows.every((r) => r.weightClass.length > 0));
});

test("effectiveDate is the injected date, not fetch time", () => {
  const rows = parseWbaFemale(FIXTURE, at);
  assert.ok(rows.every((r) => r.effectiveDate === "2026-07-24"));
});

test("empty html yields no rows, never throws", () => {
  assert.deepEqual(parseWbaFemale("<div></div>", at), []);
});

// ── The same parser now serves the MEN'S page ───────────────────────────────
// Boxing showed only women's champions because every registered boxing source
// was a female list. The men's connector is the same function with a different
// page and gender, so these pin the two things that must differ — and the many
// things that must not.

test("men's rows keep the BARE division name", () => {
  // Men's is the unmarked case, exactly as the sport writes it. Prefixing both
  // would be wrong; prefixing neither would collapse two unrelated ladders onto
  // one WeightClass row, which is resolved by (sport, name).
  const rows = parseWba(FIXTURE, "male", at);
  assert.ok(rows.some((r) => r.weightClass === "Heavyweight"));
  assert.ok(!rows.some((r) => /^women/i.test(r.weightClass)));
});

test("men's and women's parses of the same html never share a division", () => {
  const female = new Set(parseWba(FIXTURE, "female", at).map((r) => r.weightClass));
  const male = new Set(parseWba(FIXTURE, "male", at).map((r) => r.weightClass));
  for (const d of male) assert.ok(!female.has(d), `${d} appears in both ladders`);
});

test("gender and sourceUrl follow the page, not the parser", () => {
  const rows = parseWba(FIXTURE, "male", at);
  assert.ok(rows.every((r) => r.gender === "male"));
  assert.ok(rows.every((r) => r.sourceUrl.endsWith("/wba-ranking")));
  assert.ok(parseWba(FIXTURE, "female", at).every((r) => r.sourceUrl.includes("wba-female-ranking")));
});

test("everything else is identical between the two genders", () => {
  // The organisation, the ranks, the names and the country codes are properties
  // of the PAGE, not of which ladder it is. A divergence here would mean the
  // gender parameter had leaked into parsing.
  const shape = (g: "male" | "female") =>
    parseWba(FIXTURE, g, at).map((r) => [r.rank, r.name, r.countryCode, r.organisation]);
  assert.deepEqual(shape("male"), shape("female"));
});

// ── The validator is what makes an unverified page safe to wire ─────────────

test("validator refuses a page that yielded too few divisions", () => {
  // The men's page markup has not been read by anyone here. If it differs, the
  // parser returns a handful of rows — and publishing a four-man world ranking
  // as fact is far worse than publishing nothing.
  assert.throws(() => validateWba(parseWba(FIXTURE, "male", at)), /refusing to publish a partial ranking/);
});

test("validator refuses a division with too few contenders", () => {
  const entries = Array.from({ length: 10 }, (_, i) => ({
    name: `F${i}`, weightClass: `Division ${i}`, rank: 1, gender: "male" as const,
    kind: "professional" as const, countryCode: null, organisation: "WBA",
    sport: "boxing", effectiveDate: "2026-07-24", sourceUrl: "x",
  }));
  assert.throws(() => validateWba(entries), /only 1 contenders/);
});

// ── AGAINST THE REAL PAGES ──────────────────────────────────────────────────
// The synthetic fixture above pins the parser's CONTRACT. It cannot pin the
// page, and the page is what was actually wrong: the men's connector shipped
// disabled with an inferred URL that answered 404, an unrecognised division
// header, and a column the female page does not have. All three survived a
// green synthetic suite. These run against bytes captured from the live site
// on 2026-08-07 (fixtures/wba-{male,female}.html).

const real = (g: "male" | "female") =>
  readFileSync(join(import.meta.dirname, "fixtures", `wba-${g}.html`), "utf8");
const REAL_AT = new Date("2026-08-07T00:00:00Z");

test("real men's page: 17 divisions, each a full ladder", () => {
  const rows = parseWba(real("male"), "male", REAL_AT);
  const byDivision = new Map<string, number>();
  for (const r of rows.filter((e) => e.rank >= 1)) {
    byDivision.set(r.weightClass, (byDivision.get(r.weightClass) ?? 0) + 1);
  }
  assert.equal(byDivision.size, 17, `divisions: ${[...byDivision.keys()].join(", ")}`);
  for (const [division, n] of byDivision) {
    // The WBA publishes 15 per division, but leaves individual slots "NOT
    // RATED" (cruiserweight #9 today), and those are dropped rather than
    // becoming a fighter. So the floor is 14, and the CEILING is the real
    // assertion: the bug this pins produced one division of 30 and one of zero,
    // and still passed the validator.
    assert.ok(n >= 14 && n <= 15, `${division} has ${n} contenders, expected 14-15`);
  }
  assert.doesNotThrow(() => validateWba(rows));
});

test("real men's page: an unrated slot is dropped, never named", () => {
  // Cruiserweight #9 reads "NOT RATED" on the page. Publishing a fighter called
  // NOT RATED is worse than publishing a 14-deep division.
  const rows = parseWba(real("male"), "male", REAL_AT);
  assert.ok(!rows.some((r) => /^not rated$/i.test(r.name)));
  const cruiser = rows.filter((r) => r.weightClass === "Cruiserweight" && r.rank >= 1).map((r) => r.rank);
  assert.ok(!cruiser.includes(9), "rank 9 is the unrated slot");
  assert.ok(cruiser.includes(8) && cruiser.includes(10), "the ranks either side survive");
});

test("real men's page: the REFERENCES legend never becomes a champion", () => {
  // Every legend row ("LAC: | WBA LATIN AMERICAN CHAMPION") contains the word
  // CHAMPION, so the champion branch read six of them as titleholders. They
  // would have been created as Fighter rows with open TitleReigns.
  const rows = parseWba(real("male"), "male", REAL_AT);
  for (const r of rows) {
    assert.doesNotMatch(r.name, /:$/, `legend key parsed as a fighter: "${r.name}"`);
    assert.doesNotMatch(r.name, /^\(\*+\)$/, `footnote parsed as a fighter: "${r.name}"`);
  }
  for (const junk of ["LAC:", "NABA:", "PANAF:", "INTER:", "INT. CHAMP:", "(**)"]) {
    assert.ok(!rows.some((r) => r.name === junk), `${junk} still present`);
  }
  // Champions should now be at most one or two per division (Super + World),
  // not padded by a legend that lands on whichever division parsed last.
  const champs = rows.filter((r) => r.rank === 0);
  assert.ok(champs.length <= 34, `${champs.length} champions across 17 divisions`);
  assert.ok(!champs.some((c) => c.weightClass === "Minimumweight" && /[:(]/.test(c.name)));
});

test("real men's page: Minimumweight is its own division, not folded into Light Flyweight", () => {
  // The header is `<span>MINIMUM</span>` — no "weight" suffix. An unmatched
  // header does not skip its table, it inherits the previous division's label.
  const rows = parseWba(real("male"), "male", REAL_AT);
  assert.ok(rows.some((r) => r.weightClass === "Minimumweight"), "Minimumweight present");
  assert.ok(rows.some((r) => r.weightClass === "Light Flyweight"), "Light Flyweight present");
});

test("real men's page: belt annotations never leak into fighter names", () => {
  // GOLD / INT / CON / C/NA / BALTIC are regional belts the fighter holds. They
  // sit in their own column, and joining the row folded them into the name.
  const rows = parseWba(real("male"), "male", REAL_AT);
  for (const r of rows) {
    assert.doesNotMatch(r.name, /\b(GOLD|INT|CON|BALTIC|NABA|PANAF|LAC|WBAO)\b/, `annotation in name: "${r.name}"`);
    assert.doesNotMatch(r.name, /\//, `slash annotation in name: "${r.name}"`);
  }
  // …and the fighters they were attached to are still there, correctly named.
  assert.ok(rows.some((r) => r.name === "FILIP HRGOVIC"));
  assert.ok(rows.some((r) => r.name === "TYSON FURY"));
});

test("real men's page: champions parse as rank 0 and are men", () => {
  const rows = parseWba(real("male"), "male", REAL_AT);
  const champs = rows.filter((r) => r.rank === 0);
  assert.ok(champs.length >= 14, `only ${champs.length} champions`);
  assert.ok(champs.every((c) => c.gender === "male"));
  assert.ok(champs.every((c) => c.organisation === "WBA"));
  // A real, checkable name — if the page redesigns, this is the tripwire.
  assert.ok(champs.some((c) => c.name === "NAOYA INOUE" && c.weightClass === "Super Bantamweight"));
});

test("real men's page: rival sanctioning bodies are never ingested as WBA", () => {
  // Each contenders table opens with a row naming the WBC/IBF/WBO champions.
  // Those belts are not ours to publish and must not become WBA rows.
  const rows = parseWba(real("male"), "male", REAL_AT);
  for (const r of rows) assert.doesNotMatch(r.name, /^(WBC|IBF|WBO)\b/, `rival-body row leaked: "${r.name}"`);
});

test("real female page: still parses, and gained its two minimum divisions", () => {
  // The same unmatched-header bug was live on the FEMALE page, which has been
  // in production since 2026-08-03 — it was publishing 16 divisions, not 17.
  const rows = parseWba(real("female"), "female", REAL_AT);
  const divisions = new Set(rows.filter((r) => r.rank >= 1).map((r) => r.weightClass));
  assert.equal(divisions.size, 17, [...divisions].join(", "));
  assert.ok(divisions.has("Women's Minimumweight"));
  assert.ok(divisions.has("Women's Light Minimumweight"));
  assert.ok(rows.every((r) => /^Women's /.test(r.weightClass)));
  assert.doesNotThrow(() => validateWba(rows));
});

test("real pages: footnote markers are stripped from names", () => {
  // The female page prints "IVANA HABAZIN *". Identity resolution keys on the
  // name, so the asterisk is not cosmetic — it is a second Ivana Habazin.
  const rows = [...parseWba(real("male"), "male", REAL_AT), ...parseWba(real("female"), "female", REAL_AT)];
  for (const r of rows) assert.doesNotMatch(r.name, /\*/, `footnote left on name: "${r.name}"`);
  assert.ok(rows.some((r) => r.name === "IVANA HABAZIN"));
});

test("real pages: the two ladders never share a division", () => {
  // The reason men's divisions stay unprefixed and women's do not. A collision
  // here means two unrelated ranking ladders resolve to one WeightClass row.
  const male = new Set(parseWba(real("male"), "male", REAL_AT).map((r) => r.weightClass));
  const female = new Set(parseWba(real("female"), "female", REAL_AT).map((r) => r.weightClass));
  for (const d of male) assert.ok(!female.has(d), `${d} appears in both ladders`);
});

test("validator accepts a healthy page, and tolerates a two-way tie", () => {
  // Sanctioning bodies really do rank two fighters equal. Three at the same rank
  // is parse drift, not a tie — the same rule the UFC validator applies.
  const entries = Array.from({ length: 8 }, (_, d) =>
    [1, 2, 2, 3, 4].map((rank, i) => ({
      name: `F${d}-${i}`, weightClass: `Division ${d}`, rank, gender: "male" as const,
      kind: "professional" as const, countryCode: null, organisation: "WBA",
      sport: "boxing", effectiveDate: "2026-07-24", sourceUrl: "x",
    })),
  ).flat();
  assert.doesNotThrow(() => validateWba(entries));
});
