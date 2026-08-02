// Classify every (promotion, day) event collision. WRITES NOTHING.
//
//   npm run audit:duplicates              # the classification + statistics
//   npm run audit:duplicates -- --list    # every pair, not just the totals
//   npm run audit:duplicates -- --class=same-card
//
// The integrity audit counts these; it cannot tell you what they ARE. Eight of
// them turned out to be HTML-entity corruption and merged cleanly. The other 75
// are not one problem, and merging them on the strength of a shared date would
// destroy real events — a promotion running two cards in one day is ordinary
// (ONE runs Friday Fights alongside a numbered card; a federation runs several
// divisions of one championship).
//
// So: classify first, merge only the class that is provably one card.
import { prisma } from "../src/lib/db.ts";
import { canonicalizeTitle } from "../src/lib/text/entities.ts";

const argv = process.argv.slice(2);
const showList = argv.includes("--list");
const only = argv.find((a) => a.startsWith("--class="))?.slice("--class=".length);

/**
 * What a collision IS. Ordered most-confident first; the first match wins, so a
 * pair is only ever counted once.
 */
type DupClass =
  /** Same canonical title. One card, two rows — safe to merge. */
  | "same-card"
  /** One title is the other plus a promotion prefix. Also one card. */
  | "same-card-prefixed"
  /**
   * Numbered episodes of one series on one date — "No Surrender", "No Surrender
   * 2", "No Surrender 3". DISTINCT CARDS, and the single most dangerous class
   * here: they share a promotion, a date and a source, so every naive rule calls
   * them duplicates. ONE ran these constantly through 2020-21.
   */
  | "series-episodes"
  /**
   * Two rows carrying the IDENTICAL (source, externalId). That is a genuine
   * double-write — the same upstream record landed twice.
   *
   * NOT "the same source wrote both rows", which was the first rule tried here
   * and was badly wrong: it classified 66 groups as duplicates, including every
   * division of the World Judo Championships (one source, one promotion, one
   * day, ~15 legitimate events) and ONE's numbered card alongside its Prime
   * Video card. A source producing many events for one promotion on one day is
   * ordinary; only a repeated id is evidence.
   */
  | "imported-twice"
  /** Different divisions of one championship. Separate events by design. */
  | "championship-divisions"
  /** A synthetic "Sport — DD Mon YYYY" container beside a real card. */
  | "synthetic-container"
  /** One row has bouts, the other is empty and unattributable. */
  | "empty-orphan"
  /** Genuinely different cards the same promotion ran on one day. */
  | "distinct-events";

const LABEL: Record<DupClass, string> = {
  "same-card": "Same canonical title — one card stored twice",
  "same-card-prefixed": "Same card, one title carries the promotion prefix",
  "series-episodes": "Numbered episodes of one series — DISTINCT cards",
  "imported-twice": "Identical (source, externalId) — a genuine double-write",
  "championship-divisions": "Divisions of one championship — SEPARATE events by design",
  "synthetic-container": "Synthetic daily container beside a real card",
  "empty-orphan": "One row empty, titles unrelated — needs a human",
  "distinct-events": "Different cards, same promotion, same day — legitimate",
};

/** Safe to merge without a human deciding. */
const MERGEABLE: DupClass[] = ["same-card", "same-card-prefixed", "imported-twice"];

/** "Boxing — 26 Jul 2026": the odds pipeline's daily container, not a real card. */
const SYNTHETIC = /^(boxing|mma|muay thai|kickboxing|bjj|wrestling|judo|taekwondo|sambo)\s+[-—–]\s+\d{1,2}\s+\w{3}\s+\d{4}$/i;

/** "… – Men's freestyle 57 kg" / "… — Women's 67 kg": a division sub-article. */
const DIVISION = /[-—–]\s*(men|women)(&#39;|'|’)?s\b|\b\d{2,3}\s*kg\b/i;

interface Pair {
  key: string;
  cls: DupClass;
  rows: { slug: string; name: string; bouts: number; sources: string[] }[];
}

function classify(rows: Pair["rows"]): DupClass {
  const titles = rows.map((r) => canonicalizeTitle(r.name));

  // Every pairwise comparison; a group of 3+ is classified by its strongest tie.
  for (let i = 0; i < titles.length; i++) {
    for (let j = i + 1; j < titles.length; j++) {
      if (titles[i] && titles[i] === titles[j]) return "same-card";
    }
  }
  for (let i = 0; i < titles.length; i++) {
    for (let j = i + 1; j < titles.length; j++) {
      const [a, b] = [titles[i], titles[j]];
      if (!a || !b || a === b) continue;
      // One is the other with a promotion prefix: "kings and champions" vs
      // "one fighting championship kings and champions".
      if ((a.endsWith(b) || b.endsWith(a)) && Math.min(a.length, b.length) >= 8) {
        return "same-card-prefixed";
      }
    }
  }

  // ── SERIES EPISODES, checked BEFORE any source-based rule ────────────────
  //
  // "ONE Championship: No Surrender" / "… 2" / "… 3" are three separate cards
  // that share a promotion, a date AND a source, so the importer-based rule
  // below calls all 66 of them duplicates. Merging on that would have destroyed
  // real events wholesale — the failure this whole classification exists to
  // avoid. If the titles are identical once a trailing number is removed, and
  // those numbers DIFFER, they are episodes and must be kept apart.
  const stem = (t: string) => t.replace(/\s+\d+$/, "").trim();
  const tail = (t: string) => /\s+(\d+)$/.exec(t)?.[1] ?? "";
  for (let i = 0; i < titles.length; i++) {
    for (let j = i + 1; j < titles.length; j++) {
      const [a, b] = [titles[i], titles[j]];
      if (!a || !b) continue;
      if (stem(a) === stem(b) && tail(a) !== tail(b)) return "series-episodes";
    }
  }

  // Divisions of one championship, checked BEFORE anything id-based: they all
  // come from one source on one day and are all legitimate events.
  if (rows.every((r) => DIVISION.test(r.name))) return "championship-divisions";

  // The SAME upstream record landed twice — identical source AND external id.
  const seenIds = new Set<string>();
  for (const r of rows) {
    for (const id of r.sources) {
      if (seenIds.has(id)) return "imported-twice";
      seenIds.add(id);
    }
  }
  if (rows.some((r) => SYNTHETIC.test(r.name.trim()))) return "synthetic-container";
  if (rows.some((r) => r.bouts === 0) && rows.some((r) => r.bouts > 0)) return "empty-orphan";
  return "distinct-events";
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  console.log("\n  Duplicate-event classification — reads only, writes nothing\n");

  const events = await prisma.event.findMany({
    where: { promotion: { not: null } },
    select: {
      slug: true, name: true, promotion: true, date: true,
      _count: { select: { fights: true } },
      // The VALUE matters, not just the source name — see the imported-twice note.
      externalIds: { select: { source: true, externalId: true } },
    },
    orderBy: { date: "asc" },
  });

  const groups = new Map<string, Pair["rows"]>();
  for (const e of events) {
    const key = `${e.promotion!.toLowerCase()}|${iso(e.date)}`;
    const row = {
      slug: e.slug, name: e.name, bouts: e._count.fights,
      sources: e.externalIds.map((x) => `${x.source}:${x.externalId}`),
    };
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const pairs: Pair[] = [];
  for (const [key, rows] of groups) {
    if (rows.length < 2) continue;
    pairs.push({ key, cls: classify(rows), rows });
  }

  const byClass = new Map<DupClass, Pair[]>();
  for (const p of pairs) byClass.set(p.cls, [...(byClass.get(p.cls) ?? []), p]);

  console.log(`  ${pairs.length} collision group(s) across ${events.length} attributed events\n`);

  const order: DupClass[] = [
    "same-card", "same-card-prefixed", "imported-twice",
    "series-episodes", "championship-divisions", "synthetic-container",
    "empty-orphan", "distinct-events",
  ];

  for (const cls of order) {
    const list = byClass.get(cls) ?? [];
    if (only && only !== cls) continue;
    const mergeable = MERGEABLE.includes(cls);
    console.log(`  ${mergeable ? "MERGE " : "KEEP  "} ${list.length.toString().padStart(3)}  ${LABEL[cls]}`);
    if (list.length && (showList || only)) {
      for (const p of list) {
        console.log(`          ${p.key}`);
        for (const r of p.rows) {
          console.log(`            ${r.slug} (${r.bouts} bouts) [${r.sources.join(",") || "no source"}]  "${r.name}"`);
        }
      }
    }
  }

  const mergeableCount = order.filter((c) => MERGEABLE.includes(c)).reduce((n, c) => n + (byClass.get(c)?.length ?? 0), 0);
  console.log(`\n  ${mergeableCount} group(s) are safely mergeable; ${pairs.length - mergeableCount} are legitimate or need a human.`);
  if (!showList && !only) console.log("  Re-run with --list, or --class=<name>, for the rows.\n");
  else console.log("");
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
