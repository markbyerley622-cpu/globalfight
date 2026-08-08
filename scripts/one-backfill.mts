// ONE Championship backfill — fill the events the audit measured as empty.
//
// TWO SOURCES, because they reach different eras:
//
//   npm run backfill:one -- --events            # EVENT PAGES — start here
//   npm run backfill:one -- --events --limit=60 --offset=120
//   npm run backfill:one -- --dry               # articles: match only, no writes
//   npm run backfill:one -- --pages=5 --limit=25 # articles
//
// --events reads the card straight off each event page (one/extract/matchups),
// which is where most of the gap closes: ONE's sitemap lists ~423 events and
// ~80% of those from mid-2017 onward carry a full card, results included.
// Prefer it. The default (article) mode walks the editorial results archive,
// which still reaches the pre-2017 era the event pages do not.
//
// ── Why this mode exists at all ──────────────────────────────────────────
// The cron does the same sweep, but windowed: refresh-one runs twice a week and
// advances 16 archive events per tick, so closing 400+ events through the cron
// alone takes months. This is the one-off pass that does it in a single sitting
// (~35 minutes at the 5s shared rate limit), after which the cron only has to
// maintain the front of the list.
//
// Idempotent and resume-safe: persistAggregated keys a bout on (event, corners),
// so re-running writes nothing new, and an interrupted run is resumed by
// re-running it — or continued precisely with --offset.

import { prisma } from "@/lib/db";
import { discoverOneArticles, ingestOneArticle } from "@/lib/scraper/one/ingest";
import { matchArticleToEvent, type EventCandidate } from "@/lib/scraper/one/match";
import { syncONE, discoverEvents } from "@/lib/scraper/one";
import { persistAggregated } from "@/services/sync/persist";
import type { Sport } from "@/lib/types";

const arg = (name: string, fallback: number) => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  const n = raw ? Number(raw.split("=")[1]) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const dry = process.argv.includes("--dry");
const eventsMode = process.argv.includes("--events");
const pages = arg("pages", 1);
// Article mode is a polite trickle; the event sweep is a one-off pass, so its
// default is "the whole archive" rather than a batch.
const limit = arg("limit", eventsMode ? 0 : 10);
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

/** Empty ONE events, which is the number this whole connector exists to move. */
async function emptyOneEvents(): Promise<number> {
  return prisma.event.count({
    where: {
      promotion: { contains: "ONE", mode: "insensitive" },
      date: { lt: new Date() },
      fights: { none: {} },
    },
  });
}

/**
 * Sweep ONE's event pages and persist whatever card each one carries.
 *
 * Sequential and paced by the shared fetcher — this is a sustained crawl of
 * somebody else's server, and the polite rate is the one that finishes rather
 * than the one that gets 429'd.
 */
async function sweepEventPages(before: number): Promise<void> {
  const all = await discoverEvents();
  const slice = all.slice(offset, limit > 0 ? offset + limit : undefined);
  console.log(`Discovered ${all.length} event page(s); sweeping ${slice.length} from offset ${offset}\n`);

  let withCard = 0;
  let bouts = 0;
  let written = 0;
  let cardless = 0;

  for (const [i, url] of slice.entries()) {
    let harvest;
    try {
      harvest = await syncONE({ urls: [url] });
    } catch (e) {
      console.log(`  ✗ ${url.slice(0, 70)}  (${(e as Error).message.slice(0, 60)})`);
      continue;
    }

    for (const ev of harvest.events) {
      const card = ev.fights ?? [];
      bouts += card.length;
      if (card.length) withCard++;
      else cardless++;

      // Write per event so an interrupted sweep keeps everything it reached.
      if (!dry && card.length) {
        written += await persistAggregated((ev as { sport: Sport }).sport, "events", [ev]);
      }

      const decided = card.filter((b) => b.result === "WIN").length;
      console.log(
        `  ${card.length ? "✓" : "·"} [${String(offset + i).padStart(3)}] ` +
          `${ev.date.slice(0, 10)} ${ev.name.slice(0, 46).padEnd(46)} ` +
          `${String(card.length).padStart(2)} bouts${card.length ? `, ${decided} decided` : ""}`,
      );
    }
  }

  const after = dry ? before : await emptyOneEvents();
  console.log(`\nswept=${slice.length} withCard=${withCard} cardless=${cardless} · bouts=${bouts} · events written=${written}`);
  if (dry) console.log("DRY RUN — nothing written.\n");
  else console.log(`AFTER: ${after} past ONE events with no bouts  (was ${before}, −${before - after})\n`);
}

async function main() {
  console.log(`\nDatabase: ${redactedDbTarget()}`);
  console.log(
    `Mode: ${eventsMode ? "EVENT PAGES" : "RESULTS ARTICLES"} · ` +
      `${dry ? "DRY RUN (no writes)" : "WRITE"} · ` +
      (eventsMode ? `offset=${offset} · limit=${limit || "all"}` : `pages=${pages} · limit=${limit}`) +
      `\n`,
  );

  const before = await emptyOneEvents();
  console.log(`BEFORE: ${before} past ONE events with no bouts\n`);

  if (eventsMode) return sweepEventPages(before);

  const articles = await discoverOneArticles(pages);
  console.log(`Discovered ${articles.length} results article(s)\n`);

  if (dry) {
    // Match-only. The point of the dry run is to see WHICH articles would be
    // skipped before anything is written — a high skip rate is a matching
    // problem to fix, not a reason to loosen the matcher.
    const candidates: EventCandidate[] = await prisma.event.findMany({
      where: { promotion: { contains: "ONE", mode: "insensitive" } },
      select: { id: true, name: true, date: true },
    });
    let matched = 0;
    for (const a of articles.slice(0, limit)) {
      const r = matchArticleToEvent(a.title, candidates);
      if (r.ok) {
        matched++;
        console.log(`  ✓ ${r.matchedName}`);
      } else {
        console.log(`  · SKIP (${r.reason}) ${r.names.join(" | ") || a.title.slice(0, 60)}`);
      }
    }
    console.log(`\n${matched}/${Math.min(articles.length, limit)} would match. Nothing written.\n`);
    return;
  }

  const report = { written: 0, unchanged: 0, skipped: 0, failed: 0, bouts: 0, fighters: 0 };
  for (const article of articles.slice(0, limit)) {
    const outcome = await ingestOneArticle(article);
    report[outcome.status] += 1;
    report.bouts += outcome.boutsWritten ?? 0;
    report.fighters += outcome.fightersCreated ?? 0;

    const mark = { written: "✓", unchanged: "=", skipped: "·", failed: "✗" }[outcome.status];
    console.log(
      `  ${mark} ${(outcome.eventName ?? outcome.url.slice(0, 70)).padEnd(44)} ` +
        `${outcome.boutsWritten ?? 0} bouts${outcome.reason ? `  (${outcome.reason})` : ""}`,
    );
  }

  const after = await emptyOneEvents();
  console.log(`\nAFTER: ${after} past ONE events with no bouts  (was ${before}, −${before - after})`);
  console.log(
    `written=${report.written} unchanged=${report.unchanged} skipped=${report.skipped} ` +
      `failed=${report.failed} · bouts=${report.bouts} · new fighters=${report.fighters}\n`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
