// ════════════════════════════════════════════════════════════════════════
//  Wikipedia elimination-bracket → bouts. PURE — no network, no prisma.
//
//  These sports do not publish a fight card. "Wrestling at the 2024 Summer
//  Olympics – Men's freestyle 74 kg" publishes a tree:
//
//      Round of 32        Round of 16        Quarterfinals
//                      ┌ Kyle Dake (USA) 10
//                      │ Anthony Montero (VEN) 0     ┌ Kyle Dake (USA) 11F
//
//  A match is TWO competitor cells in the SAME grid column on ADJACENT rows.
//  That is the entire model, and it holds for wrestling, judo and taekwondo
//  because they all render from the same {{NTeamBracket}} family of templates.
//
//  Two signals decide the winner, in order:
//    1. BOLD. The template bolds whoever advanced. Sport-independent.
//    2. Higher final score, only when neither corner is bolded.
//  When neither settles it the bout is emitted UNDECIDED. A bracket that shows a
//  pairing without an outcome is a real fact worth storing; a guessed winner is not.
// ════════════════════════════════════════════════════════════════════════

import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { tableGrid, rightOf, indexCells, type GridCell } from "./grid";
import type { TournamentBout } from "./types";

/**
 * Round labels, most significant first. `rank` orders the card: the Final is the
 * main event, a qualification-round bout is the opener.
 */
const ROUNDS: { re: RegExp; label: string; rank: number }[] = [
  { re: /^gold medal|^final\b|^finals?$/i, label: "Final", rank: 100 },
  { re: /bronze/i, label: "Bronze medal match", rank: 90 },
  { re: /semi[\s-]?finals?/i, label: "Semifinals", rank: 80 },
  { re: /quarter[\s-]?finals?/i, label: "Quarterfinals", rank: 70 },
  { re: /round of 16|eighth[\s-]?finals?/i, label: "Round of 16", rank: 60 },
  { re: /round of 32/i, label: "Round of 32", rank: 50 },
  { re: /round of 64/i, label: "Round of 64", rank: 40 },
  { re: /repechage/i, label: "Repechage", rank: 30 },
  { re: /qualification|preliminary|first round|prelims?/i, label: "Qualification", rank: 20 },
];

const UNKNOWN_RANK = 10;

/**
 * A competitor cell WITH its country: "Kyle Dake (USA)", "1 Yang Yung-wei (TPE)".
 *
 * Not every article prints the country, though — see `looksLikeName` below.
 */
const COMPETITOR = /^(.{2,60}?)\s*\(([A-Za-z]{2,4})\)$/;

/**
 * A leading seed number, which some articles print INSIDE the name cell
 * ("18 Andrea Carlino (ITA)") and others give a cell of its own ("| 5 | Park
 * Tae-joon (KOR) |").
 *
 * Stripping it is not cosmetic. Left on, it becomes part of the fighter's name
 * and slug, so the same athlete is two people: "1 Yang Yung-wei" from the
 * Olympic bracket and "Yang Yung-wei" from the world-championship one. 25 judo
 * fighters were created that way before this was caught.
 */
const SEED_PREFIX = /^\d{1,3}\s+/;

/**
 * Is this text plausibly a person, for a cell that has a score beside it?
 *
 * Used only when the country-code form does not match. The structural signal —
 * "a text cell whose right-hand neighbour is a score" — is what carries the
 * recall here, so this only has to reject the things that structure lets through.
 */
function looksLikeName(text: string): boolean {
  if (text.length < 3 || text.length > 60) return false;
  if (!/\p{L}{2}/u.test(text)) return false; // needs real letters, not "01"
  if (/^\d+$/.test(text)) return false;
  return true;
}

/** Score cells: "10", "0", "11F", "VSU", "1s1", "10-0", "—". */
const SCORE = /^(?:[0-9]{1,3}[A-Za-z]{0,3}|[A-Z]{2,4}[0-9]?|[0-9]{1,2}[-–][0-9]{1,2}|[0-9]s[0-9])$/;

/** Tables that are never brackets — they carry their own, different meaning. */
const NOT_A_BRACKET = /wikitable|infobox|navbox|sidebar|toccolours|tablesorter|mw-collapsible/i;

interface Competitor {
  name: string;
  country: string | null;
  cell: GridCell;
  score: string | null;
  /** Bold on the name cell OR on any of its score cells. */
  won: boolean;
}

/** Round label covering a grid column, chosen from the tightest matching header. */
function roundForColumn(headers: { from: number; to: number; label: string; rank: number }[], col: number) {
  let best: { label: string; rank: number; width: number } | null = null;
  for (const h of headers) {
    if (col < h.from || col >= h.to) continue;
    const width = h.to - h.from;
    if (!best || width < best.width) best = { label: h.label, rank: h.rank, width };
  }
  return best ? { round: best.label, rank: best.rank } : { round: null, rank: UNKNOWN_RANK };
}

function classify(text: string) {
  for (const r of ROUNDS) if (r.re.test(text)) return r;
  return null;
}

/** Read one bracket table into competitors + the round each column represents. */
function readTable($: cheerio.CheerioAPI, table: Element): TournamentBout[] {
  const cells = tableGrid($, table);
  if (cells.length < 4) return [];

  // ── Which cells are people ────────────────────────────────────────────────
  const index = indexCells(cells);
  const competitors: Competitor[] = [];
  for (const cell of cells) {
    if (!cell.text) continue;
    // A round label can end in a parenthesised token; never read one as a person.
    if (classify(cell.text)) continue;

    // Scores sit immediately right of the name. Taekwondo prints one cell per
    // round ("9 | 13"), so take the run and keep it whole.
    const scores: GridCell[] = [];
    let next = rightOf(index, cell);
    while (next && scores.length < 3 && next.text && SCORE.test(next.text)) {
      scores.push(next);
      next = rightOf(index, next);
    }

    // TWO accepted forms, and the second one is not optional.
    //
    // Requiring the trailing "(USA)" was a deliberate precision trade, and it
    // cost three quarters of the judo corpus: the World Judo Championships
    // brackets print a bare "Jorre Verstraeten" while the Olympic ones print
    // "11 Jorre Verstraeten (BEL)". 36 of 48 division pages parsed to zero bouts
    // and were reported as "no bracket found" — a source-shaped answer to what
    // was really our own over-strict pattern.
    //
    // So: use the country form when it is there, and otherwise fall back to the
    // structural signal that a bracket actually guarantees — a name cell has a
    // SCORE cell immediately to its right. Round headers have a header beside
    // them, and spacers have nothing, so neither survives that test.
    const m = COMPETITOR.exec(cell.text);
    const rawName = (m ? m[1] : cell.text).replace(SEED_PREFIX, "").trim();
    const country = m ? m[2].toUpperCase() : null;
    if (!m && !scores.length) continue;
    if (!looksLikeName(rawName)) continue;

    competitors.push({
      name: rawName,
      country,
      cell,
      score: scores.map((s) => s.text).join(" ") || null,
      won: cell.bold || scores.some((s) => s.bold),
    });
  }
  if (competitors.length < 2) return [];

  // ── Which columns are which round ─────────────────────────────────────────
  // Header cells live on rows that carry no competitors ("Round of 32 | Round of
  // 16 | …"), and a sub-bracket can repeat them lower down ("Repechage | Bronze
  // Medal"), so every row is scanned rather than just the first.
  const competitorRows = new Set(competitors.map((c) => c.cell.row));
  const headers: { from: number; to: number; label: string; rank: number }[] = [];
  for (const cell of cells) {
    if (competitorRows.has(cell.row) || !cell.text) continue;
    const hit = classify(cell.text);
    if (!hit) continue;
    headers.push({ from: cell.col, to: cell.col + cell.colspan, label: hit.label, rank: hit.rank });
  }

  // ── Pair them ─────────────────────────────────────────────────────────────
  const byColumn = new Map<number, Competitor[]>();
  for (const c of competitors) {
    const list = byColumn.get(c.cell.col) ?? [];
    list.push(c);
    byColumn.set(c.cell.col, list);
  }

  const bouts: TournamentBout[] = [];
  for (const [col, list] of byColumn) {
    list.sort((a, b) => a.cell.row - b.cell.row);
    const { round, rank } = roundForColumn(headers, col);

    for (let i = 0; i < list.length - 1; ) {
      const a = list[i];
      const b = list[i + 1];
      // Adjacent rows = one match. A larger gap means `a` had a bye (or the other
      // half of its match is drawn in a different sub-table), so `a` is dropped
      // rather than paired with whoever happens to come next.
      if (b.cell.row - a.cell.row > 2) {
        i += 1;
        continue;
      }
      // Both bolded or neither: fall back to the score, then give up honestly.
      let winner: "red" | "blue" | null = a.won && !b.won ? "red" : b.won && !a.won ? "blue" : null;
      if (!winner) winner = byScore(a.score, b.score);

      bouts.push({
        round,
        rank,
        redName: a.name,
        redCountry: a.country,
        blueName: b.name,
        blueCountry: b.country,
        winner,
        redScore: a.score,
        blueScore: b.score,
        origin: "bracket",
      });
      i += 2;
    }
  }
  return bouts;
}

/**
 * Last-resort winner: the higher trailing number. Only consulted when the
 * template did not bold anyone. Returns null on a tie or anything unparseable —
 * a wrestling "VSU" vs "VPO1" is not a number comparison.
 */
function byScore(a: string | null, b: string | null): "red" | "blue" | null {
  const num = (s: string | null): number | null => {
    if (!s) return null;
    const last = s.trim().split(/\s+/).pop() ?? "";
    const m = /^(\d{1,3})/.exec(last);
    return m ? Number.parseInt(m[1], 10) : null;
  };
  const x = num(a);
  const y = num(b);
  if (x === null || y === null || x === y) return null;
  return x > y ? "red" : "blue";
}

/**
 * Every bout on a division page.
 *
 * Deduped on the corner pair: the same semi-final is drawn in both the main
 * bracket and the "Semifinals | Final" summary table, and the medal round appears
 * twice again. The instance from the most significant round wins, and a decided
 * reading beats an undecided one.
 */
export function parseBrackets(html: string): TournamentBout[] {
  const $ = cheerio.load(html);
  const found: TournamentBout[] = [];

  $("table").each((_, table) => {
    const cls = $(table).attr("class") ?? "";
    if (NOT_A_BRACKET.test(cls)) return;
    found.push(...readTable($, table));
  });

  const best = new Map<string, TournamentBout>();
  for (const bout of found) {
    const key = [bout.redName.toLowerCase(), bout.blueName.toLowerCase()].sort().join("|");
    const held = best.get(key);
    if (!held) {
      best.set(key, bout);
      continue;
    }
    // Decided beats undecided; among equals, the more significant round wins.
    const boutDecided = bout.winner !== null;
    const heldDecided = held.winner !== null;
    const better =
      boutDecided !== heldDecided ? boutDecided : bout.rank > held.rank;
    if (better) best.set(key, bout);
  }

  return [...best.values()].sort((a, b) => b.rank - a.rank);
}
