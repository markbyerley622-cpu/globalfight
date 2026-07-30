// Results doctor — "why is THIS event still Pending?", answered per event.
//
//   npm run results:doctor                    # every pending event, worst first
//   npm run results:doctor -- --limit 60
//   npm run results:doctor -- --stale 21      # only events inside the cron's window
//
// Point it at production by exporting DATABASE_URL first. The banner always says
// which database it read.
//
// This exists because the pipeline already computed the answer and threw it away.
// syncWikiCards produces a precise per-event `reason` — no_candidate / all_rejected /
// no_card / unverified / error — and runner.ts logged `outcomes: undefined`, so
// production could report "noCandidate=3" and never which three events those were.
// The reason is now persisted on Event.resultAttemptReason, which makes this tool one
// query rather than a re-run of the whole harvest.
//
// To go deeper on a single bout, the harvester has a real trace mode:
//   npm run results:backfill -- --fight "Fighter A vs Fighter B" --explain
//
// Read-only. It changes nothing and it never invents a result.
import { prisma } from "../src/lib/db.ts";
import { countWikiGaps, RESULT_BACKFILL_DAYS } from "../src/lib/scraper/wikicard/index.ts";

const argv = process.argv.slice(2);
const num = (name: string, dflt: number) => {
  const i = argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : dflt;
};
const limit = num("limit", 40);
const staleDays = num("stale", 0);

function dbTarget(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) return "(DATABASE_URL not set)";
  try {
    const u = new URL(raw);
    return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch { return "(unparseable DATABASE_URL)"; }
}

/**
 * What each stored reason MEANS, and what to do about it. A category with no next
 * action is the thing that made "Pending" useless in the first place.
 */
const MEANING: Record<string, string> = {
  "": "NEVER ATTEMPTED — the harvester has not looked at this event even once.",
  partial:
    "Real bouts were found and stored, but NOT enough of the card. The bouts it has are " +
    "correct; the event is simply incomplete and stays eligible for another attempt.",
  name_mismatch:
    "OURS TO FIX. The source HAS this bout on the right date, under a name we did not " +
    "match (see the note). Add a FighterAlias, or extend lib/entities/resolve.ts.",
  no_candidate: "Search returned no page at all. Likely no Wikipedia coverage (common for regional cards).",
  all_rejected: "Pages were found but every one was refused on its title. Check the scoring, or the event name.",
  no_card: "A page was accepted but no bout table could be parsed from it. Suspect HTML/selector drift.",
  unverified: "A page parsed, but no bout on it resolved to our two fighters. NAME MATCHING — the prime suspect.",
  error: "The attempt threw. See the stored note (rate limit, network, parser exception).",
  verified: "Last attempt DID verify — if bouts are still SCHEDULED the failure is downstream, in persistence.",
};

/**
 * Worst first. `partial` sorts just after never-attempted: it is the state most likely
 * to succeed on a retry (a page exists and parses; we just did not get enough of it),
 * so it is the most actionable thing on the list after the untouched events.
 */
function rank(reason: string | null): number {
  if (!reason) return 0;
  const base = reason.split(":")[0];
  if (base === "verified") return 5;
  if (base === "no_candidate") return 4;
  // Top of the list after never-attempted: the source has the result and only our
  // matching is in the way, so it is the most fixable thing here.
  if (base === "name_mismatch") return 1;
  if (base === "partial") return 2;
  return 3;
}

const ago = (d: Date | null): string => {
  if (!d) return "never";
  const m = Math.round((Date.now() - d.getTime()) / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};

async function main() {
  console.log(`\nDatabase: ${dbTarget()}`);

  const now = new Date();
  const gaps = await countWikiGaps(now);
  console.log(
    `Pending: ${gaps.missingResultEvents} events / ${gaps.missingResultBouts} bouts` +
    `  ·  cards with no bouts at all: ${gaps.missingCardEvents}`,
  );
  console.log(`Cron window: last ${RESULT_BACKFILL_DAYS} days (RESULTS_BACKFILL_WINDOW_DAYS)`);

  const where = {
    date: staleDays
      ? { gte: new Date(now.getTime() - staleDays * 86_400_000), lt: now }
      : { lt: now },
    status: { notIn: ["DRAFT", "CANCELLED", "POSTPONED"] as const },
    fights: { some: { result: "SCHEDULED" as const } },
  };

  const events = await prisma.event.findMany({
    where,
    orderBy: [{ resultAttemptAt: { sort: "asc", nulls: "first" } }, { date: "desc" }],
    take: limit,
    select: {
      name: true, slug: true, date: true, promotion: true, sport: true,
      resultAttemptAt: true, resultAttempts: true, resultAttemptReason: true, resultCoverage: true,
      _count: { select: { fights: true } },
      fights: { where: { result: "SCHEDULED" }, select: { id: true } },
    },
  });

  if (!events.length) {
    console.log("\nNothing pending. Every completed card has its results.\n");
    return;
  }

  // The starvation check. Before the queue was changed to least-recently-attempted,
  // the hourly job always took the NEWEST batch — so events past the batch size were
  // never attempted once and then aged out of the window permanently. A non-zero
  // count here on a mature database is that bug still present, or a backlog that has
  // not yet rotated through.
  const never = events.filter((e) => !e.resultAttemptAt).length;
  const inWindow = events.filter(
    (e) => !e.resultAttemptAt && e.date >= new Date(now.getTime() - RESULT_BACKFILL_DAYS * 86_400_000),
  ).length;
  console.log(
    `\nNever attempted: ${never} of ${events.length} shown  (${inWindow} still inside the cron window, ` +
    `${never - inWindow} already aged out and now reachable only by --historical)\n`,
  );

  const sorted = [...events].sort(
    (a, b) => rank(a.resultAttemptReason) - rank(b.resultAttemptReason),
  );

  for (const e of sorted) {
    const base = (e.resultAttemptReason ?? "").split(":")[0];
    const pending = e.fights.length;
    console.log(`${e.name}`);
    console.log(`    ${e.date.toISOString().slice(0, 10)} · ${e.sport} · ${e.promotion ?? "(no promotion)"} · /events/${e.slug}`);
    const cov = e.resultCoverage === null ? "—" : `${e.resultCoverage}%`;
    console.log(`    ${pending} of ${e._count.fights} bouts unconfirmed · coverage: ${cov} · attempts: ${e.resultAttempts} · last: ${ago(e.resultAttemptAt)}`);
    console.log(`    reason:  ${e.resultAttemptReason ?? "(none recorded)"}`);
    console.log(`    means:   ${MEANING[base] ?? "Unrecognised reason — check WikiTargetOutcome.reason."}`);
    console.log();
  }

  console.log(`Deeper trace for one bout:`);
  console.log(`  npm run results:backfill -- --fight "<Fighter A> vs <Fighter B>" --explain\n`);
  console.log(`Force a pass over the aged-out backlog:`);
  console.log(`  npm run results:backfill -- --historical --limit 40 --batches 20\n`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
