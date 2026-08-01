// ════════════════════════════════════════════════════════════════════════
//  Rowspan/colspan-aware table grid. PURE — no network, no prisma.
//
//  Why this exists rather than `$(tr).find("td").eq(n)`:
//
//  A Wikipedia bracket is drawn with spacer cells. The connector lines between
//  rounds are `rowspan="6" colspan="4"` empty cells, so the SAME visual column
//  has a different nth-child index on almost every row. Reading cells by their
//  position within their own <tr> put "Kyle Dake" in column 5 on one row and
//  column 7 two rows later — which made two competitors in the same match look
//  like they were in different rounds, and the pairing collapsed.
//
//  Resolving the true grid coordinate is the whole trick. Once every cell knows
//  its (row, col), a match is just two competitor cells in one column on
//  adjacent rows.
// ════════════════════════════════════════════════════════════════════════

import type * as cheerio from "cheerio";
import type { Element } from "domhandler";

export interface GridCell {
  /** Index of the <tr>, 0-based. */
  row: number;
  /** TRUE grid column after accounting for every span above and to the left. */
  col: number;
  colspan: number;
  rowspan: number;
  text: string;
  /**
   * Wikipedia brackets bold the competitor who advanced. This is the primary
   * winner signal — it is the same across wrestling, judo and taekwondo, whereas
   * the score column is sport-specific ("11F", "VSU", "9 13", "1s1").
   */
  bold: boolean;
  node: Element;
}

const clean = (s: string): string => s.replace(/\[\w+\]/g, "").replace(/\s+/g, " ").trim();

const span = (raw: string | undefined): number => {
  const n = Number.parseInt(raw ?? "1", 10);
  // A malformed span must never become 0 (infinite loop) or huge (memory).
  return Number.isFinite(n) && n >= 1 && n <= 64 ? n : 1;
};

/**
 * Every cell of ONE table with its resolved grid coordinate.
 *
 * Direct children only: a nested table (an infobox inside a cell) belongs to its
 * own grid, and folding it into this one would invent adjacencies.
 */
export function tableGrid($: cheerio.CheerioAPI, table: Element): GridCell[] {
  const body = $(table).children("tbody");
  const trs = (body.length ? body.children("tr") : $(table).children("tr")).toArray();

  // Occupancy of coordinates claimed by a rowspan/colspan started earlier.
  const taken = new Set<string>();
  const out: GridCell[] = [];

  trs.forEach((tr, row) => {
    let col = 0;
    $(tr)
      .children("td,th")
      .each((_, node) => {
        while (taken.has(`${row}:${col}`)) col += 1;
        const colspan = span($(node).attr("colspan"));
        const rowspan = span($(node).attr("rowspan"));
        for (let r = row; r < row + rowspan; r++) {
          for (let c = col; c < col + colspan; c++) taken.add(`${r}:${c}`);
        }
        out.push({
          row,
          col,
          colspan,
          rowspan,
          text: clean($(node).text()),
          bold: $(node).find("b").length > 0,
          node,
        });
        col += colspan;
      });
  });

  return out;
}

/**
 * Coordinate index for O(1) neighbour lookups.
 *
 * Needed because the score-cell scan runs for EVERY cell, and a linear search per
 * lookup made that quadratic — noticeable on a 50-row judo bracket repeated across
 * 48 division pages.
 */
export function indexCells(cells: GridCell[]): Map<string, GridCell> {
  const index = new Map<string, GridCell>();
  for (const c of cells) index.set(`${c.row}:${c.col}`, c);
  return index;
}

/** The cell immediately right of `cell` in the grid, if any. */
export function rightOf(index: Map<string, GridCell>, cell: GridCell): GridCell | undefined {
  return index.get(`${cell.row}:${cell.col + cell.colspan}`);
}
