import { test } from "node:test";
import assert from "node:assert/strict";
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
  assert.ok(rows.every((r) => r.sourceUrl.includes("wba-rankings")));
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
