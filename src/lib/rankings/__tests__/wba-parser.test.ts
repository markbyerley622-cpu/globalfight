import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWbaFemale } from "../connectors/wba";

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
  const champ = rows.find((r) => r.rank === 0 && r.weightClass === "Heavyweight");
  assert.ok(champ, "heavyweight champion present");
  assert.equal(champ!.name, "CLARESSA SHIELDS");
  assert.equal(champ!.countryCode, "US");
  assert.equal(champ!.organisation, "WBA");
  assert.equal(champ!.gender, "female");
});

test("parses contenders and drops NOT RATED", () => {
  const rows = parseWbaFemale(FIXTURE, at);
  const hw = rows.filter((r) => r.weightClass === "Heavyweight" && r.rank >= 1);
  assert.deepEqual(hw.map((r) => [r.rank, r.name]), [
    [2, "MINELLIS BLANCO"],
    [3, "ANNIE MAZEROLLE"],
  ]);
  assert.equal(hw[0].countryCode, "CO");
});

test("normalizes division labels and carries them across the pair", () => {
  const rows = parseWbaFemale(FIXTURE, at);
  assert.ok(rows.some((r) => r.weightClass === "Super Lightweight" && r.name === "KYLIE EPPERSON"));
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
