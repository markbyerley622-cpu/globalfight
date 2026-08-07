// Why does a card fail to parse? Root-cause distribution, not a list of events.
//
//   npm run triage:wikicards -- --promotion one           # from the DB
//   npm run triage:wikicards -- --names "ONE 173|ONE X"   # without a DB
//   npm run triage:wikicards -- --promotion one --limit 20
//
// The point of this tool is the AGGREGATE. Fixing 24 events one at a time
// produces 24 patches and no understanding; if 18 of them share one HTML shape,
// that shape is one fix. So every failure is classified by CAUSE and the causes
// are counted, and the per-event lines are there to check the classification,
// not to work through.
//
// It writes nothing to the database. It fetches public Wikipedia pages through
// the shared honest fetcher and runs the REAL extractor against them, so a
// "would parse" here means the production path would parse it too.
import { prisma } from "../src/lib/db.ts";
import * as cheerio from "cheerio";
import { searchPages, fetchPageHtml } from "../src/lib/scraper/wikicard/client.ts";
import { parseWikiCard } from "../src/lib/scraper/wikicard/extract.ts";

const argv = process.argv.slice(2);
const value = (name: string): string | undefined => {
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const parts: string[] = [];
  for (let j = i + 1; j < argv.length && !argv[j].startsWith("--"); j++) parts.push(argv[j]);
  return parts.length ? parts.join(" ") : undefined;
};

const promotion = value("promotion");
const namesArg = value("names");
const limit = Number(value("limit") ?? 40);

/**
 * Why this event produced no card. Ordered from "outside our control" to
 * "our bug", because that ordering is the triage.
 */
type Cause =
  | "NO_SOURCE_PAGE"          // search returned nothing plausible
  | "PAGE_HAS_NO_TABLE"       // page exists, carries no results table at all
  | "SEPARATOR_NOT_IN_COL_2"  // the def./vs. column is somewhere else — OUR BUG
  | "TOO_FEW_CELLS"           // bout rows exist but with < 4 <td>
  | "SEPARATOR_MISSING"       // table present, no def./vs. anywhere
  | "PARSED_OK";              // the extractor handles it today

interface Diagnosis {
  event: string;
  page: string | null;
  cause: Cause;
  bouts: number;
  detail: string;
}

/**
 * Look at the page the way the extractor does, and report what it would have
 * needed. The interesting number is `sepCol`: which column actually holds the
 * "def." / "vs." separator. The extractor hard-codes 2.
 */
function diagnose(html: string): { cause: Cause; bouts: number; detail: string } {
  const bouts = parseWikiCard(html);
  if (bouts.length > 0) return { cause: "PARSED_OK", bouts: bouts.length, detail: `${bouts.length} bouts` };

  const $ = cheerio.load(html);
  const tables = $("table.toccolours, table.wikitable");
  if (tables.length === 0) return { cause: "PAGE_HAS_NO_TABLE", bouts: 0, detail: "no toccolours/wikitable" };

  // Where does the separator actually live?
  const sepCols = new Map<number, number>();
  let rowsWithSep = 0;
  let maxCells = 0;
  let shortRows = 0;

  tables.each((_, table) => {
    $(table).find("tr").each((__, tr) => {
      const cells = $(tr).find("td").toArray().map((td) => $(td).text().replace(/\s+/g, " ").trim());
      maxCells = Math.max(maxCells, cells.length);
      const at = cells.findIndex((c) => /^(def\.?|vs\.?)\b/i.test(c));
      if (at >= 0) {
        rowsWithSep++;
        sepCols.set(at, (sepCols.get(at) ?? 0) + 1);
        if (cells.length < 4) shortRows++;
      }
    });
  });

  if (rowsWithSep === 0) {
    return {
      cause: "SEPARATOR_MISSING",
      bouts: 0,
      detail: `${tables.length} table(s), no def./vs. cell (maxCells=${maxCells})`,
    };
  }
  const cols = [...sepCols].sort((a, b) => b[1] - a[1]);
  const [topCol, topCount] = cols[0];
  if (topCol !== 2) {
    return {
      cause: "SEPARATOR_NOT_IN_COL_2",
      bouts: 0,
      detail: `separator in column ${topCol} on ${topCount} row(s) — extractor hard-codes 2 ` +
        `(cols seen: ${cols.map(([c, n]) => `${c}×${n}`).join(", ")})`,
    };
  }
  if (shortRows > 0) {
    return { cause: "TOO_FEW_CELLS", bouts: 0, detail: `${shortRows} bout row(s) with <4 <td>` };
  }
  return { cause: "SEPARATOR_MISSING", bouts: 0, detail: `unclassified (rowsWithSep=${rowsWithSep})` };
}

async function targets(): Promise<string[]> {
  if (namesArg) return namesArg.split("|").map((s) => s.trim()).filter(Boolean);
  const rows = await prisma.event.findMany({
    where: {
      date: { lt: new Date() },
      status: { notIn: ["DRAFT", "CANCELLED", "POSTPONED"] },
      fights: { none: {} },
      ...(promotion ? { promotion: { contains: promotion, mode: "insensitive" as const } } : {}),
    },
    orderBy: { date: "desc" },
    take: limit,
    select: { name: true },
  });
  return rows.map((r) => r.name);
}

const names = await targets();
console.log(`\ntriaging ${names.length} event(s)${promotion ? ` · promotion~"${promotion}"` : ""}\n`);

const results: Diagnosis[] = [];
for (const name of names) {
  let page: string | null = null;
  try {
    const [best] = await searchPages(name, 1);
    page = best ?? null;
    if (!page) {
      results.push({ event: name, page: null, cause: "NO_SOURCE_PAGE", bouts: 0, detail: "search returned nothing" });
      continue;
    }
    const fetched = await fetchPageHtml(page);
    if (!fetched) {
      results.push({ event: name, page, cause: "NO_SOURCE_PAGE", bouts: 0, detail: "page fetch returned null" });
      continue;
    }
    if (fetched.title !== page) page = fetched.title;
    const d = diagnose(fetched.html);
    results.push({ event: name, page, ...d });
  } catch (e) {
    results.push({ event: name, page, cause: "NO_SOURCE_PAGE", bouts: 0, detail: `error: ${(e as Error).message}` });
  }
}

// ── THE OUTPUT THAT MATTERS ────────────────────────────────────────────────
const byCause = new Map<Cause, Diagnosis[]>();
for (const r of results) byCause.set(r.cause, [...(byCause.get(r.cause) ?? []), r]);

console.log("── root-cause distribution ─────────────────────────────────");
for (const [cause, rows] of [...byCause].sort((a, b) => b[1].length - a[1].length)) {
  const pct = ((rows.length / results.length) * 100).toFixed(0);
  console.log(`  ${String(rows.length).padStart(3)}  ${pct.padStart(3)}%  ${cause}`);
}

console.log("\n── detail ──────────────────────────────────────────────────");
for (const [cause, rows] of [...byCause].sort((a, b) => b[1].length - a[1].length)) {
  if (cause === "PARSED_OK") continue;
  console.log(`\n  ${cause}`);
  for (const r of rows.slice(0, 12)) {
    console.log(`    ${r.event}`);
    console.log(`      page="${r.page ?? "—"}" ${r.detail}`);
  }
  if (rows.length > 12) console.log(`    … and ${rows.length - 12} more`);
}

await prisma.$disconnect().catch(() => {});
