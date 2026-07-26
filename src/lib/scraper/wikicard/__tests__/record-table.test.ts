import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecordTable, findRecordRow, recordRowToBout, parseRecordDate } from "../record-table";

// Most bouts never get a Wikipedia article — searching "Anthony Joshua vs Kristian
// Prenga" returns three biographies and no fight page. But the fighter's own page
// carries their complete record, and the row for the bout holds winner, method,
// round, time AND date. This is the shape of that real table.

const RECORD_HTML = `
<table class="wikitable">
  <tr><th>No.</th><th>Result</th><th>Record</th><th>Opponent</th><th>Type</th><th>Round, time</th><th>Date</th><th>Location</th></tr>
  <tr><td>22</td><td>Loss</td><td>20–2</td><td>Anthony Joshua</td><td>KO</td><td>2 (12), 2:43</td><td>25 Jul 2026</td><td>Jeddah</td></tr>
  <tr><td>21</td><td>Win</td><td>20–1</td><td>Joe Jones</td><td>TKO</td><td>1 (8), 1:57</td><td>21 Feb 2026</td><td>Atlantic City</td></tr>
  <tr><td>20</td><td>Draw</td><td>19–1</td><td>Someone Else</td><td>SD</td><td>10 (10)</td><td>3 Jan 2025</td><td>London</td></tr>
</table>`;

const EVENT_DATE = new Date("2026-07-25T21:00:00Z");

test("a career-record table is parsed, including the leading No. column offset", () => {
  const rows = parseRecordTable(RECORD_HTML);
  assert.equal(rows.length, 3);
  const [latest] = rows;
  assert.equal(latest.outcome, "loss");
  assert.equal(latest.opponent, "Anthony Joshua");
  assert.equal(latest.method, "KO");
  assert.equal(latest.round, 2, "'2 (12), 2:43' → round 2, not 12");
  assert.equal(latest.time, "2:43");
  assert.equal(latest.date?.toISOString().slice(0, 10), "2026-07-25");
});

test("a LOSS on the owner's record means the OPPONENT won — corners flip", () => {
  // Getting this backwards records every result with the wrong winner.
  const rows = parseRecordTable(RECORD_HTML);
  const bout = recordRowToBout(rows[0], "Kristian Prenga");
  assert.equal(bout.redName, "Anthony Joshua", "red is the winner, per the card convention");
  assert.equal(bout.blueName, "Kristian Prenga");
  assert.equal(bout.decided, true);
  assert.equal(bout.method, "KO");
  assert.equal(bout.round, 2);
});

test("a WIN keeps the owner in the red corner", () => {
  const rows = parseRecordTable(RECORD_HTML);
  const bout = recordRowToBout(rows[1], "Kristian Prenga");
  assert.equal(bout.redName, "Kristian Prenga");
  assert.equal(bout.blueName, "Joe Jones");
});

test("a draw is carried as undecided-by-winner, not as a win", () => {
  const rows = parseRecordTable(RECORD_HTML);
  const bout = recordRowToBout(rows[2], "Kristian Prenga");
  assert.equal(bout.decided, false, "a draw has no winner to put in the red corner");
});

test("the row is matched by DATE — a rematch cannot overwrite the first fight", () => {
  const rows = parseRecordTable(RECORD_HTML);
  const isJoshua = (n: string) => /joshua/i.test(n);

  const hit = findRecordRow(rows, EVENT_DATE, isJoshua);
  assert.ok(hit, "the 25 Jul 2026 row matches the 25 Jul 2026 event");
  assert.equal(hit!.round, 2);

  // Same opponent, a year earlier: no row is within tolerance, so nothing is written.
  const wrongDate = findRecordRow(rows, new Date("2025-07-25T21:00:00Z"), isJoshua);
  assert.equal(wrongDate, null, "an out-of-window row must never be used");
});

test("an opponent who is not on our bout never matches", () => {
  const rows = parseRecordTable(RECORD_HTML);
  assert.equal(findRecordRow(rows, EVENT_DATE, (n) => /crawford/i.test(n)), null);
});

test("a row with no readable date is never used", () => {
  const rows = parseRecordTable(`
    <table><tr><th>Result</th><th>Opponent</th><th>Date</th></tr>
    <tr><td>Loss</td><td>Anthony Joshua</td><td>TBA</td></tr></table>`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, null);
  assert.equal(findRecordRow(rows, EVENT_DATE, () => true), null, "undated rows cannot be placed");
});

test("an EVENT card table is not mistaken for a record table", () => {
  // No Result/Opponent header pair — parseWikiCard's territory, not this module's.
  const rows = parseRecordTable(`
    <table class="toccolours"><tr><td>Heavyweight</td><td>A</td><td>def.</td><td>B</td><td>KO</td></tr></table>`);
  assert.equal(rows.length, 0);
});

test("parseRecordDate handles the formats Wikipedia actually uses", () => {
  for (const s of ["25 Jul 2026", "25 July 2026", "2026-07-25"]) {
    assert.equal(parseRecordDate(s)?.toISOString().slice(0, 10), "2026-07-25", s);
  }
  assert.equal(parseRecordDate("TBA"), null);
  assert.equal(parseRecordDate(""), null);
});

// ── the two conventions ─────────────────────────────────────────────────────
// Boxing heads the outcome column "Result" and merges "Round, time"; MMA heads it
// "Res." and splits Round and Time. Requiring the boxing spelling made every MMA
// biography parse to ZERO rows while boxing worked perfectly — invisible until the
// trace printed "record rows=0" on an MMA fighter's page.

const MMA_HTML = `
<table class="wikitable">
  <tr><th>Res.</th><th>Record</th><th>Opponent</th><th>Method</th><th>Event</th><th>Date</th><th>Round</th><th>Time</th><th>Location</th></tr>
  <tr><td>Win</td><td>17–0</td><td>Max Holloway</td><td>KO (punches)</td><td>UFC 308</td><td>26 Oct 2024</td><td>3</td><td>1:34</td><td>Abu Dhabi</td></tr>
  <tr><td>Loss</td><td>16–1</td><td>Someone Else</td><td>Submission</td><td>UFC 300</td><td>13 Apr 2024</td><td>2</td><td>4:10</td><td>Las Vegas</td></tr>
</table>`;

test("an MMA record table ('Res.' + separate Time column) parses", () => {
  const rows = parseRecordTable(MMA_HTML);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].outcome, "win");
  assert.equal(rows[0].opponent, "Max Holloway");
  assert.equal(rows[0].method, "KO (punches)");
  assert.equal(rows[0].round, 3);
  assert.equal(rows[0].time, "1:34", "the separate Time column is used");
  assert.equal(rows[0].date?.toISOString().slice(0, 10), "2024-10-26");
});

test("MMA corners flip on a loss, exactly as boxing does", () => {
  const rows = parseRecordTable(MMA_HTML);
  const bout = recordRowToBout(rows[1], "Ilia Topuria");
  assert.equal(bout.redName, "Someone Else");
  assert.equal(bout.blueName, "Ilia Topuria");
});
