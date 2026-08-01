// Remove bouts the year-page backfill wrote onto the WRONG card.
//
//   npm run repair:year-misattribution                    # dry run, reports only
//   npm run repair:year-misattribution -- --apply
//   npm run repair:year-misattribution -- --promotion=one --years=2020-2021
//
// THE BUG THIS REPAIRS
//   eventMatchKey cut a card's name at the first colon to get its designation.
//   That works for "ONE Fight Night 45: Lessei vs. Rabah" (-> "one fight night
//   45") but collapses "ONE Championship: No Surrender 2" to "one championship" —
//   and ONE ran No Surrender 2 AND 3 on the same night. Every such card on a given
//   date shared one key, so the second card's bouts were written onto the first
//   card's row, under the first card's name. Measured: 12 rows across 2020-2021
//   carried roughly double their true bout count.
//
//   eventMatchKey is fixed (it now keeps the headline when the head carries no
//   number, with regression tests). Re-running places bouts correctly from here
//   on — but nothing DELETES a bout, so the already-misplaced ones need this.
//
// THE RULE
//   For each card the source describes, take that section's corner pairs. On the
//   matching event, delete only fights that are BOTH:
//     • absent from that section, AND
//     • recorded in FightImport as CREATED by wikipedia-year
//   The provenance half is what makes this safe: a bout ESPN or another provider
//   owns is never touched, even if this source does not list it.
//
// ROLLBACK
//   Deleted bouts are re-derivable: rerun `npm run backfill:year` and the source
//   rewrites whatever legitimately belongs on each card.
import { prisma } from "../src/lib/db.ts";
import { splitYearPage } from "../src/lib/scraper/promotion-index/year-split.ts";
import { parseWikiCard } from "../src/lib/scraper/wikicard/extract.ts";
import {
  eventMatchKey, YEAR_SOURCE, YEAR_PAGE_SOURCES, yearPageTitle, type YearPageSource,
} from "../src/lib/scraper/promotion-index/index.ts";
import { wikiPage } from "../src/lib/scraper/tournament/wiki.ts";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const value = (n: string): string | undefined => {
  const inline = argv.find((a) => a.startsWith(`--${n}=`));
  if (inline) return inline.slice(n.length + 3);
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
};

const apply = flag("apply");
const requested = (value("promotion") ?? "all").split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
const sources: YearPageSource[] = requested.includes("all")
  ? YEAR_PAGE_SOURCES
  : YEAR_PAGE_SOURCES.filter((s) => requested.includes(s.key));
if (!sources.length) { console.error("unknown promotion"); process.exit(1); }

const thisYear = new Date().getFullYear();
const yearsArg = value("years");
let years: number[];
if (yearsArg) {
  const m = /^(\d{4})(?:\s*[-–]\s*(\d{4}))?$/.exec(yearsArg.trim());
  if (!m) { console.error("--years must be YYYY or YYYY-YYYY"); process.exit(1); }
  const from = Number(m[1]), to = Number(m[2] ?? m[1]);
  years = Array.from({ length: to - from + 1 }, (_, i) => from + i);
} else {
  const earliest = Math.min(...sources.map((s) => s.firstYear));
  years = Array.from({ length: thisYear - earliest + 1 }, (_, i) => earliest + i);
}

const [conn] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
console.log(`database   : ${conn.db}`);
console.log(`promotions : ${sources.map((s) => s.key).join(", ")}`);
console.log(`years      : ${years[0]}–${years[years.length - 1]}`);
console.log(`mode       : ${apply ? "APPLY — bouts will be deleted" : "DRY RUN — nothing is deleted"}`);

// ── comparing a source name to a stored one ─────────────────────────────────
//
// These are NOT the same string. The source writes "DonKing YotharakMuayThai";
// entity resolution stores "DonKing Yotharak Muay Thai". Diacritics, spacing and
// punctuation all drift. A naive comparison flagged 202 bouts as foreign —
// including "Worapon vs Soner Şen" on the card titled "Worapon vs. Şen 3" — and
// applying that would have DELETED REAL BOUTS.
//
// So the key strips everything that drifts: case, accents, and every non-letter.
const norm = (s: string | null | undefined): string =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const pair = (a: string | null | undefined, b: string | null | undefined): string =>
  [norm(a), norm(b)].sort().join("|");

// ── the sticky half of the bug ──────────────────────────────────────────────
//
// Deleting the stray bouts is not enough. persistAggregated resolves an event by
// its EXTERNAL ID before anything else, and the bad run linked several sections
// to one event row. Those links outlive the fix: a rerun looks up the section's
// external id, lands on the same wrong row, and rewrites the same wrong bouts —
// which is exactly what happened on the first attempt to repair this.
//
// One card is one section, so an event carrying more than one of this source's
// links is definitionally wrong. All of that event's links from this source are
// dropped, and the rerun re-links each section to the row its name and date
// actually resolve to. Only this source's links are touched.
async function clearPoisonedLinks(): Promise<number> {
  const links = await prisma.eventExternalId.findMany({
    where: { source: YEAR_SOURCE },
    select: { id: true, eventId: true },
  });
  const byEvent = new Map<string, string[]>();
  for (const l of links) byEvent.set(l.eventId, [...(byEvent.get(l.eventId) ?? []), l.id]);
  const doomed = [...byEvent.values()].filter((ids) => ids.length > 1).flat();
  if (!doomed.length) return 0;
  console.log(`\n  ${doomed.length} link(s) across ${doomed.length / 2} event(s) point several cards at one row`);
  if (!apply) return doomed.length;
  const res = await prisma.eventExternalId.deleteMany({ where: { id: { in: doomed } } });
  return res.count;
}

let scanned = 0, offending = 0, removable = 0, deleted = 0;

for (const source of sources) {
  // ── what the source says each card is ──────────────────────────────────────
  const sections = new Map<string, { name: string; pairs: Set<string>; bouts: number }>();
  for (const year of years) {
    if (year < source.firstYear) continue;
    const title = yearPageTitle(source, year);
    let page: { title: string; html: string } | null = null;
    try { page = await wikiPage(title); } catch { continue; }
    if (!page) continue;
    for (const s of splitYearPage(page.html).sections) {
      const bouts = parseWikiCard(s.cardHtml);
      sections.set(`${eventMatchKey(s.name)}@${s.date!.slice(0, 10)}`, {
        name: s.name,
        pairs: new Set(bouts.map((b) => pair(b.redName, b.blueName))),
        bouts: bouts.length,
      });
    }
  }
  console.log(`\n${source.promotion}: ${sections.size} card(s) described by the source`);

  const rows = await prisma.event.findMany({
    where: { promotion: source.promotion },
    select: {
      id: true, name: true, date: true,
      fights: {
        select: {
          id: true,
          red: { select: { name: true } },
          blue: { select: { name: true } },
          imports: { where: { source: YEAR_SOURCE }, select: { created: true } },
        },
      },
    },
  });

  for (const ev of rows) {
    const key = `${eventMatchKey(ev.name)}@${ev.date.toISOString().slice(0, 10)}`;
    const src = sections.get(key);
    if (!src) continue; // the source does not describe this card — leave it alone
    scanned += 1;

    // ── bound 1: only a card that demonstrably holds too many ────────────────
    //
    // The misattribution shows up as an over-count — the card carries its own
    // bouts PLUS a sibling's. When db <= source there is no excess to remove, and
    // any name that fails to match is a normalisation artefact, not a stray. This
    // is what keeps an imperfect comparison from deleting real data.
    const excess = ev.fights.length - src.bouts;
    if (excess <= 0) continue;

    const candidates = ev.fights.filter((f) => {
      if (src.pairs.has(pair(f.red?.name, f.blue?.name))) return false;
      // Only what THIS path created. A bout another provider owns stays, even
      // when the source does not list it.
      return f.imports.some((i) => i.created);
    });

    // ── bound 2: never remove more than the excess ───────────────────────────
    //
    // A hard cap. Even if the comparison mis-scores a bout, the card cannot be
    // cut below the count the source says it should have.
    const strays = candidates.slice(0, excess);
    if (!strays.length) continue;

    offending += 1;
    removable += strays.length;
    console.log(
      `  ${ev.date.toISOString().slice(0, 10)}  ${ev.name}\n` +
      `      db=${ev.fights.length}  source=${src.bouts}  removing ${strays.length} not on this card`,
    );
    for (const f of strays.slice(0, 3)) {
      console.log(`        – ${f.red?.name ?? "?"} vs ${f.blue?.name ?? "?"}`);
    }
    if (strays.length > 3) console.log(`        … and ${strays.length - 3} more`);

    if (apply) {
      const res = await prisma.fight.deleteMany({ where: { id: { in: strays.map((f) => f.id) } } });
      deleted += res.count;
    }
  }
}

const links = await clearPoisonedLinks();

console.log("\n── result ──────────────────────────────────────────────────────");
console.log(`  cards checked against the source : ${scanned}`);
console.log(`  bad source links ${apply ? "cleared" : "to clear"}        : ${links}`);
console.log(`  cards carrying foreign bouts     : ${offending}`);
console.log(`  bouts ${apply ? "deleted" : "that would be deleted"}          : ${apply ? deleted : removable}`);
if (!apply && removable) console.log("\n  Re-run with --apply to delete. Then rerun `npm run backfill:year`.");

await prisma.$disconnect();
