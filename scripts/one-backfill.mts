// ONE Championship backfill — fill the events the audit measured as empty.
//
//   npm run backfill:one -- --dry              # match only, write nothing
//   npm run backfill:one -- --pages=5 --limit=25
//
// Target from `npm run audit:quality`: 251 ONE events with no bouts at all.
//
// Idempotent and resume-safe with no cursor: an article whose bouts already
// exist writes nothing, so an interrupted run is resumed by running it again.
// `--limit` bounds a single run so this is many small passes rather than one
// long one against a third party.

import { prisma } from "@/lib/db";
import { discoverOneArticles, ingestOneArticle } from "@/lib/scraper/one/ingest";
import { matchArticleToEvent, type EventCandidate } from "@/lib/scraper/one/match";

const arg = (name: string, fallback: number) => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  const n = raw ? Number(raw.split("=")[1]) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const dry = process.argv.includes("--dry");
const pages = arg("pages", 1);
const limit = arg("limit", 10);

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

async function main() {
  console.log(`\nDatabase: ${redactedDbTarget()}`);
  console.log(`Mode: ${dry ? "DRY RUN (no writes)" : "WRITE"} · pages=${pages} · limit=${limit}\n`);

  const before = await emptyOneEvents();
  console.log(`BEFORE: ${before} past ONE events with no bouts\n`);

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
