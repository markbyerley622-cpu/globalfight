// BKFC backfill — recover bout RESULTS into existing BKFC events.
//
//   npm run backfill:bkfc -- --events --limit=3 --dry     # fetch+parse, write nothing
//   npm run backfill:bkfc -- --events                     # whole archive (~17 min)
//   npm run backfill:bkfc -- --events --offset=50 --limit=50
//   npm run backfill:bkfc -- --audit                      # measure only, no fetching
//
// ── What this recovers ───────────────────────────────────────────────────
// BKFC event pages render the winner client-side and ship all four result
// variants unmarked, which is why every BKFC card sat with no result. The page
// declares its official scored feed in an inline script; the provider now reads
// it. See src/lib/scraper/bkfc/results-feed.ts for the measured evidence.
//
// ── Cost ─────────────────────────────────────────────────────────────────
// TWO requests per event (page + feed) at the shared rate limit. The cron does
// the same sweep windowed (24 events/tick); this is the one-off pass that closes
// the archive in a single sitting, after which the cron only maintains the front.
//
// Idempotent: persistAggregated keys a bout on (event, corners), so re-running
// updates in place and writes nothing new. Resume with --offset.

import { prisma } from "@/lib/db";
import { syncBKFC, discover } from "@/lib/scraper/bkfc";
import { persistAggregated } from "@/services/sync/persist";
import { readFlags } from "@/lib/feature-flags";

const arg = (name: string, fallback: number) => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  const n = raw ? Number(raw.split("=")[1]) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const dry = process.argv.includes("--dry");
const auditOnly = process.argv.includes("--audit");
const limit = arg("limit", 0);
const offset = arg("offset", 0);

function redactedDbTarget(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) return "(DATABASE_URL unset)";
  try {
    const u = new URL(raw);
    return `${u.hostname}/${u.pathname.replace(/^\//, "")}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

const BKFC = { promotion: { contains: "BKFC", mode: "insensitive" as const } };

/** The numbers this connector exists to move. */
async function audit() {
  const now = new Date();
  const [events, completed, withBouts, bouts, decided, unknownRuleset, titles] = await Promise.all([
    prisma.event.count({ where: BKFC }),
    prisma.event.count({ where: { ...BKFC, date: { lt: now } } }),
    prisma.event.count({ where: { ...BKFC, fights: { some: {} } } }),
    prisma.fight.count({ where: { event: BKFC } }),
    prisma.fight.count({ where: { event: BKFC, result: { in: ["WIN", "DRAW", "NO_CONTEST"] } } }),
    prisma.fight.count({ where: { event: BKFC, ruleset: "UNKNOWN" } }),
    prisma.fight.count({ where: { event: BKFC, titleFight: true } }),
  ]);
  const emptyCompleted = await prisma.event.count({
    where: { ...BKFC, date: { lt: now }, fights: { none: {} } },
  });
  const completedNoResult = await prisma.event.count({
    where: { ...BKFC, date: { lt: now }, fights: { some: {}, none: { result: { in: ["WIN", "DRAW", "NO_CONTEST"] } } } },
  });
  return { events, completed, withBouts, emptyCompleted, completedNoResult, bouts, decided, unknownRuleset, titles };
}

function printAudit(label: string, a: Record<string, number>) {
  console.log(`\n${label}`);
  for (const [k, v] of Object.entries(a)) console.log(`  ${k.padEnd(20)} ${String(v).padStart(7)}`);
}

async function main() {
  console.log(`\nDatabase: ${redactedDbTarget()}`);
  const before = await audit();
  printAudit("BEFORE", before);
  if (auditOnly) return;

  // ── COMPLIANCE GATE ─────────────────────────────────────────────────────
  // The sweep's whole purpose is the scored feed, so running it with the gate
  // off would spend ~17 minutes of somebody's rate limit to re-write cards that
  // already exist, and report a misleading "0 decided" as if the parser failed.
  // Refuse loudly instead. --dry is still allowed: it writes nothing, and being
  // able to see what WOULD be ingested is exactly what the operator needs to
  // make the licensing decision.
  if (!readFlags().bkfcResultsEnabled && !dry) {
    console.error(
      `\nREFUSING TO RUN — BKFC_RESULTS_ENABLED is not "true".\n\n` +
        `  The BKFC results feed (xapi.mmareg.com) has NO legal basis recorded. See the\n` +
        `  'bkfc-results' entry in src/lib/ingestion-registry.ts for the three facts behind\n` +
        `  that call, and src/lib/feature-flags.ts for what turning it on commits you to.\n\n` +
        `  Without the feed this sweep would re-fetch every card and write no results.\n` +
        `  BKFC results continue to arrive via the licensed Wikipedia (wikicard) path.\n\n` +
        `  --dry still works and shows exactly what would be ingested.\n`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nMode: EVENT PAGES + OFFICIAL FEED · ${dry ? "DRY RUN (no writes)" : "WRITE"} · offset=${offset} · limit=${limit || "all"}\n`);

  const all = await discover();
  const slice = all.events.slice(offset, limit > 0 ? offset + limit : undefined);
  console.log(`Discovered ${all.events.length} event page(s); sweeping ${slice.length} from offset ${offset}\n`);

  let withCard = 0, cardless = 0, bouts = 0, decided = 0, titles = 0, written = 0, linked = 0, feedRejected = 0;

  for (const [i, url] of slice.entries()) {
    let h;
    try {
      // One event per call so an interrupted sweep keeps everything it reached.
      h = await syncBKFC({ mode: "daily", entities: ["events"], eventUrls: [url] });
    } catch (e) {
      console.log(`  x [${String(offset + i).padStart(3)}] ${url.slice(0, 64)}  (${(e as Error).message.slice(0, 50)})`);
      continue;
    }
    feedRejected += h.report.warnings.filter((w) => /feed REJECTED/i.test(w)).length;

    for (const ev of h.events) {
      const card = ev.fights ?? [];
      const d = card.filter((f) => f.result === "WIN" || f.result === "DRAW" || f.result === "NO_CONTEST").length;
      bouts += card.length;
      decided += d;
      titles += card.filter((f) => f.titleFight).length;
      linked += card.filter((f) => f.redExternalId && f.blueExternalId).length;
      if (card.length) withCard++; else cardless++;

      if (!dry && card.length) written += await persistAggregated("BARE_KNUCKLE", "events", [ev]);

      console.log(
        `  ${card.length ? (d ? "+" : "o") : "."} [${String(offset + i).padStart(3)}] ` +
          `${(ev.date ?? "").slice(0, 10)} ${ev.name.slice(0, 42).padEnd(42)} ` +
          `${String(card.length).padStart(2)} bouts, ${String(d).padStart(2)} decided`,
      );
    }
  }

  console.log(
    `\nswept=${slice.length} withCard=${withCard} cardless=${cardless} · bouts=${bouts} ` +
      `decided=${decided} titles=${titles} bothCornersLinked=${linked} feedRejected=${feedRejected} · events written=${written}`,
  );

  if (dry) {
    console.log("\nDRY RUN — nothing written.\n");
    return;
  }
  const after = await audit();
  printAudit("AFTER", after);
  console.log("\nDELTA");
  for (const k of Object.keys(before) as (keyof typeof before)[]) {
    const d = after[k] - before[k];
    if (d !== 0) console.log(`  ${k.padEnd(20)} ${String(before[k]).padStart(7)} → ${String(after[k]).padStart(7)}  (${d > 0 ? "+" : ""}${d})`);
  }
  console.log();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
