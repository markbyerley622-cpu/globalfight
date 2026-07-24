import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUfcRankings, validateUfcRankings } from "../ufc";
import type { RankingEntry } from "../../connector";

// A UFC-shaped grouping: header, a champion block, and ranked rows.
function group(header: string, champion: string, contenders: string[]): string {
  const rows = contenders
    .map((n, i) => `<tr><td class="views-field-weight-class-rank">${i + 1}</td><td class="views-field-title"><a href="#">${n}</a></td></tr>`)
    .join("");
  return `<div class="view-grouping">
    <div class="view-grouping-header">${header}</div>
    <div class="rankings--athlete--champion"><a href="#">${champion}</a></div>
    <table><tbody>${rows}</tbody></table>
  </div>`;
}

const at = new Date("2026-07-24T00:00:00Z");

const FIXTURE = `<div>
  ${group("Men's Pound-for-Pound Top Rank", "Islam Makhachev", ["Islam Makhachev", "Alexander Volkanovski"])}
  ${group("Flyweight", "Alexandre Pantoja", ["Alexandre Pantoja", "Manel Kape", "Brandon Royval"])}
  ${group("Women's Flyweight", "Valentina Shevchenko", ["Valentina Shevchenko", "Manon Fiorot"])}
  ${group("Flyweight", "Alexandre Pantoja", ["Alexandre Pantoja", "Manel Kape", "Brandon Royval"])}
</div>`;

test("skips pound-for-pound groups (v1 owns divisions only)", () => {
  const rows = parseUfcRankings(FIXTURE, at);
  assert.ok(!rows.some((r) => /pound/i.test(r.weightClass)), "no P4P entries");
  assert.ok(!rows.some((r) => r.name === "Alexander Volkanovski"), "P4P-only fighter not ingested");
});

test("parses a men's division: champion at rank 0, contenders 1..N", () => {
  const fly = parseUfcRankings(FIXTURE, at).filter((r) => r.weightClass === "Flyweight" && r.gender === "male");
  assert.deepEqual(fly.map((r) => [r.rank, r.name]), [
    [0, "Alexandre Pantoja"],
    [1, "Alexandre Pantoja"],
    [2, "Manel Kape"],
    [3, "Brandon Royval"],
  ]);
  assert.equal(fly[0].organisation, "UFC");
  assert.equal(fly[0].sport, "mma");
});

test("women's divisions keep the prefix and never collide with men's", () => {
  const rows = parseUfcRankings(FIXTURE, at);
  const wFly = rows.filter((r) => r.weightClass === "Women's Flyweight");
  assert.ok(wFly.length > 0 && wFly.every((r) => r.gender === "female"));
  assert.ok(rows.some((r) => r.weightClass === "Flyweight" && r.gender === "male"));
});

test("de-duplicates a division UFC renders twice", () => {
  const rows = parseUfcRankings(FIXTURE, at);
  const kape = rows.filter((r) => r.name === "Manel Kape");
  assert.equal(kape.length, 1, "Manel Kape appears once despite the duplicate grouping");
});

test("effectiveDate is the injected date", () => {
  assert.ok(parseUfcRankings(FIXTURE, at).every((r) => r.effectiveDate === "2026-07-24"));
});

// ── validate phase ────────────────────────────────────────────────────────
function fake(div: string, gender: "male" | "female", ranks: number[]): RankingEntry[] {
  return ranks.map((rank) => ({
    name: `${div}-${rank}`, weightClass: div, rank, gender, kind: "professional" as const,
    countryCode: null, organisation: "UFC", sport: "mma", effectiveDate: "2026-07-24", sourceUrl: "u",
  }));
}

test("validate throws when too few divisions parsed (partial page)", () => {
  const tooFew = [...Array(5)].flatMap((_, i) => fake(`D${i}`, "male", [1, 2, 3, 4, 5]));
  assert.throws(() => validateUfcRankings(tooFew), /partial ranking/);
});

test("validate throws on a near-empty division", () => {
  const thin = [...Array(11)].flatMap((_, i) => fake(`D${i}`, "male", i === 0 ? [1, 2] : [1, 2, 3, 4, 5]));
  assert.throws(() => validateUfcRankings(thin), /only 2 contenders/);
});

test("validate ALLOWS a legitimate 2-way tie (real UFC data)", () => {
  const withTie = [...Array(11)].flatMap((_, i) => fake(`D${i}`, "male", i === 0 ? [1, 2, 3, 4, 9, 9] : [1, 2, 3, 4, 5]));
  assert.doesNotThrow(() => validateUfcRankings(withTie));
});

test("validate throws when a rank appears 3+ times (parse drift, not a tie)", () => {
  const drift = [...Array(11)].flatMap((_, i) => fake(`D${i}`, "male", i === 0 ? [1, 1, 1, 4, 5] : [1, 2, 3, 4, 5]));
  assert.throws(() => validateUfcRankings(drift), /appears 3/);
});

test("validate passes a healthy set", () => {
  const ok = [...Array(11)].flatMap((_, i) => fake(`D${i}`, "male", [1, 2, 3, 4, 5]));
  assert.doesNotThrow(() => validateUfcRankings(ok));
});
