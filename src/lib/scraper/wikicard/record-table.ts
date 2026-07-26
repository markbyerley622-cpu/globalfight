// ════════════════════════════════════════════════════════════════════════════
//  Fighter career-record tables — the source that was under our nose.
//
//  PURE. No prisma, no network.
//
//  Most bouts never get their own Wikipedia article. Searching for "Anthony Joshua vs
//  Kristian Prenga" returns three biographies and no fight page, and that is true for
//  the overwhelming majority of the 1,754 unresolved bouts. The event-card extractor
//  reads `X def. Y` rows, so a biography looked worthless and the candidate scorer
//  learned to refuse them.
//
//  It was wrong. A boxing biography carries the fighter's COMPLETE professional
//  record as a structured table:
//
//    No. | Result | Record | Opponent       | Type | Round, time | Date        | …
//    22  | Loss   | 20–2   | Anthony Joshua | KO   | 2 (12), 2:43| 25 Jul 2026 | …
//
//  That single row is the whole result — winner, method, round, time and DATE — from
//  the same licensed source, for a bout with no article of its own. It is better
//  evidence than a fight page: the date column lets us prove we matched the right
//  bout rather than an earlier meeting between the same two fighters.
//
//  Nothing here infers. A row is used only when its opponent resolves to the other
//  corner AND its date matches the event. Otherwise it is ignored.
// ════════════════════════════════════════════════════════════════════════════

import * as cheerio from "cheerio";
import type { WikiBout } from "./extract";

export interface RecordRow {
  /** From the bio owner's perspective. */
  outcome: "win" | "loss" | "draw" | "nc";
  opponent: string;
  method: string | null;
  round: number | null;
  time: string | null;
  /** The row's date, parsed. Null when unreadable — such a row is never used. */
  date: Date | null;
}

const clean = (s: string) => s.replace(/\[\d+\]/g, "").replace(/\s+/g, " ").trim();

/** "Loss" / "Win" / "Draw" / "NC" — the first column that decides everything. */
function toOutcome(cell: string): RecordRow["outcome"] | null {
  const c = cell.toLowerCase();
  if (c.startsWith("win")) return "win";
  if (c.startsWith("loss")) return "loss";
  if (c.startsWith("draw")) return "draw";
  if (c.startsWith("nc") || c.includes("no contest")) return "nc";
  return null;
}

/** "2 (12), 2:43" → round 2, time "2:43". The bracket is the scheduled distance. */
function parseRoundTime(cell: string): { round: number | null; time: string | null } {
  const round = /^(\d+)/.exec(cell.trim());
  const time = /(\d{1,2}:\d{2})/.exec(cell);
  return {
    round: round ? Number.parseInt(round[1], 10) : null,
    time: time ? time[1] : null,
  };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * "25 Jul 2026" / "25 July 2026" / "2026-07-25" → UTC midnight. Null when unreadable.
 *
 * Parsed as UTC deliberately. `new Date("25 Jul 2026")` yields LOCAL midnight, which
 * `toISOString()` then shifts to the 24th or the 26th depending on where the machine
 * is — a silent ±1 day on a field we match bouts by. Whether a run is correct must not
 * depend on the operator's timezone.
 */
export function parseRecordDate(cell: string): Date | null {
  const s = clean(cell);
  if (!s) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return utc(+iso[1], +iso[2] - 1, +iso[3]);

  // "25 Jul 2026" / "25 July 2026"
  const dmy = /^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/.exec(s);
  if (dmy) {
    const m = MONTHS.indexOf(dmy[2].slice(0, 3).toLowerCase());
    if (m >= 0) return utc(+dmy[3], m, +dmy[1]);
  }

  // "Jul 25, 2026" / "July 25, 2026"
  const mdy = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
  if (mdy) {
    const m = MONTHS.indexOf(mdy[1].slice(0, 3).toLowerCase());
    if (m >= 0) return utc(+mdy[3], m, +mdy[2]);
  }

  return null;
}

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

/**
 * Every readable row of a fighter's career-record table.
 *
 * Located by its HEADER — a table with Result AND Opponent columns — rather than by
 * position or class, because the same page also carries infoboxes, amateur records
 * and navboxes, and their order is not stable across articles.
 */
export function parseRecordTable(html: string): RecordRow[] {
  const $ = cheerio.load(html);
  const out: RecordRow[] = [];

  $("table").each((_, table) => {
    const headers = $(table)
      .find("tr")
      .first()
      .find("th")
      .toArray()
      .map((th) => clean($(th).text()).toLowerCase());
    const iResult = headers.findIndex((h) => h === "result");
    const iOpponent = headers.findIndex((h) => h === "opponent");
    if (iResult < 0 || iOpponent < 0) return;

    const iType = headers.findIndex((h) => h === "type" || h === "method");
    const iRound = headers.findIndex((h) => h.startsWith("round"));
    const iDate = headers.findIndex((h) => h === "date");

    $(table)
      .find("tr")
      .each((__, tr) => {
        const cells = $(tr).find("td").toArray().map((td) => clean($(td).text()));
        if (cells.length < Math.max(iResult, iOpponent) + 1) return;

        // A record table's data rows carry a leading "No." cell that the header row
        // counts as a column, so cell indexes can be shifted by one. Align by finding
        // the outcome word rather than trusting the offset.
        let shift = 0;
        let outcome = toOutcome(cells[iResult] ?? "");
        if (!outcome) {
          const found = cells.findIndex((c) => toOutcome(c) !== null);
          if (found < 0) return;
          shift = found - iResult;
          outcome = toOutcome(cells[found]);
        }
        if (!outcome) return;

        const at = (i: number) => (i >= 0 ? cells[i + shift] ?? "" : "");
        const opponent = at(iOpponent);
        if (!opponent) return;

        const rt = parseRoundTime(at(iRound));
        out.push({
          outcome,
          opponent,
          method: at(iType) || null,
          round: rt.round,
          time: rt.time,
          date: parseRecordDate(at(iDate)),
        });
      });
  });

  return out;
}

/** How far a record row's date may sit from the event's. Time zones and late cards. */
export const DATE_TOLERANCE_DAYS = 3;

/**
 * Turn ONE record row into a bout, seen from the outside.
 *
 * The row is written from the bio owner's perspective ("Loss" means the OPPONENT
 * won), and the card extractor's convention is that the RED corner is the winner —
 * `X def. Y`. So a loss flips the corners. Getting this backwards would record every
 * result with the wrong winner, which is why it is one small function with one job.
 */
export function recordRowToBout(row: RecordRow, ownerName: string): WikiBout {
  const decided = row.outcome === "win" || row.outcome === "loss";
  const ownerWon = row.outcome === "win";
  return {
    weightClass: null,
    ruleset: null,
    redName: ownerWon ? ownerName : row.opponent,
    blueName: ownerWon ? row.opponent : ownerName,
    decided,
    method: row.outcome === "draw" ? "Draw" : row.outcome === "nc" ? "No contest" : row.method,
    round: row.round,
    time: row.time,
    titleFight: false,
  };
}

/**
 * The row on this fighter's record that IS the bout we are looking for.
 *
 * Two independent conditions, both required:
 *   • the opponent name matches the other corner (compared by the caller, which owns
 *     entity resolution), and
 *   • the row's date is within DATE_TOLERANCE_DAYS of the event.
 *
 * The date is what makes this safe. Fighters meet twice; without it a rematch would
 * silently overwrite the first fight's result with the second's.
 */
export function findRecordRow(
  rows: RecordRow[],
  eventDate: Date,
  opponentMatches: (name: string) => boolean,
): RecordRow | null {
  const toleranceMs = DATE_TOLERANCE_DAYS * 86_400_000;
  const dated = rows.filter(
    (r) => r.date && Math.abs(r.date.getTime() - eventDate.getTime()) <= toleranceMs,
  );
  return dated.find((r) => opponentMatches(r.opponent)) ?? null;
}
