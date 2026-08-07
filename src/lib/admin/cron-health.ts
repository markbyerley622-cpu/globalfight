// ════════════════════════════════════════════════════════════════════════
//  Cron health — "is the scheduler actually working?"
//
//  Every scheduled run already writes a ScrapeJob row (runner.ts: RUNNING →
//  SUCCESS/FAILED, with the error text). Nothing ever READ those rows, so there
//  was no way to answer the only question that matters about a cron: did it fire,
//  and did it do anything?
//
//  That blind spot is what let the results pipeline stay dead for weeks. The
//  hourly job fired correctly, the Wikipedia fetch threw because ENABLE_SCRAPER
//  was "false", the handler reported 200 `ok:true`, and Render's dashboard showed
//  a green run. The DB knew the truth the whole time — 100% FAILED rows for
//  `results:wikicard` — and nothing surfaced it.
//
//  This module reads that history and reports, per expected job: when it last
//  ran, whether it succeeded, the last error, and whether it is OVERDUE for its
//  declared cadence. Overdue is the important one: a job that stopped being
//  scheduled at all leaves no failure row behind, so silence is the only signal.
// ════════════════════════════════════════════════════════════════════════

import "server-only";
import { prisma } from "@/lib/db";

/**
 * The jobs we expect to see, and how often. Mirrors the cron services in
 * render.yaml / the crons array in vercel.json.
 *
 * `targets` are the ScrapeJob.target values the route produces (see the switch in
 * runner.ts) — a route can write several. `everyMinutes` is its cadence; a job is
 * flagged overdue past GRACE × cadence, so a single missed tick on a slow hourly
 * job is not reported as an outage.
 */
export interface ExpectedJob {
  /** The /api/cron/<route> that drives it. */
  route: string;
  label: string;
  targets: string[];
  everyMinutes: number;
  /** Why an operator should care that this one stopped. */
  matters: string;
}

export const EXPECTED_JOBS: ExpectedJob[] = [
  {
    route: "refresh-results",
    label: "Fight results",
    targets: ["results:wikicard", "results:intelligence"],
    everyMinutes: 60,
    matters: "Completed cards show \"Result pending\" until this runs.",
  },
  {
    route: "resolve-picks",
    label: "Pick settlement",
    targets: ["picks:resolve"],
    everyMinutes: 60,
    matters: "Users never find out whether they called a fight right.",
  },
  {
    route: "refresh-enrich",
    label: "Fighter photos + bios",
    targets: ["enrich"],
    everyMinutes: 60,
    matters: "New fighters have no face.",
  },
  {
    route: "ingest-feed",
    label: "Video catalog",
    targets: ["feed:ingest"],
    everyMinutes: 60,
    matters: "/clips renders its empty state.",
  },
  {
    route: "refresh-news",
    label: "News",
    targets: ["news", "news:og-images"],
    everyMinutes: 360,
    matters: "The news surface goes stale.",
  },
  {
    route: "refresh-events",
    label: "Upcoming events",
    targets: ["events:adapters"],
    everyMinutes: 1440,
    matters: "No new cards appear on the schedule.",
  },
  {
    route: "refresh-odds",
    label: "Odds",
    targets: ["odds"],
    everyMinutes: 720,
    matters: "Underdog/favourite framing goes stale.",
  },
  {
    route: "refresh-wikicards",
    label: "Fight cards (Wikipedia)",
    // Two targets, because the route now makes two calls. It used to emit a
    // single "wikicards" target covering both gaps in one budget, which is
    // exactly the bug that starved the card queue to zero. Splitting the call
    // renamed the targets, and cron:doctor immediately reported the truth —
    // "run history exists for targets no expected job declares: wikicards:cards,
    // wikicards:results" — while this entry still waited for a name nothing
    // emits any more. Left alone, the job would have aged into a false
    // "never run" alert with the real runs sitting right next to it, unclaimed.
    targets: ["wikicards:results", "wikicards:cards"],
    everyMinutes: 5040,
    matters: "Events exist with no bouts on them.",
  },
  // ── The registry jobs ────────────────────────────────────────────────────
  // Added by the data-integrity sprint. This list covered 8 of the 22 cron
  // routes, and the three that decide what the RANKINGS and CHAMPIONS pages
  // publish were not among them — so "champions are out of date" was invisible
  // to the one tool built to answer exactly that question.
  //
  // Expect these to report `never-run` on first deploy. That is the point: a job
  // that has never run should say so loudly rather than be absent from the list
  // that claims to be complete.
  {
    route: "refresh-rankings",
    label: "Rankings (official connectors)",
    targets: ["rankings:ingest"],
    // Weekly, per render.yaml. Sanctioning bodies republish roughly that often;
    // the payload hash means asking more frequently costs nothing but also
    // gains nothing.
    everyMinutes: 10_080,
    matters: "Divisional boards freeze at whatever the last successful run published.",
  },
  {
    route: "refresh-p4p",
    label: "Pound-for-pound",
    targets: ["p4p:records", "p4p:curated", "p4p:generate"],
    everyMinutes: 1440,
    matters: "P4P boards and the derived records behind them go stale.",
  },
  {
    route: "refresh-champions",
    label: "Champions",
    targets: ["champions:project"],
    everyMinutes: 1440,
    matters: "Title changes are not picked up — the belt shows the previous holder.",
  },
  // ── Promotion ingests ───────────────────────────────────────────────────
  // Found by the orphan-target check added alongside this list: all five had run
  // history in production (mma:roster 58 runs, bkfc:sync 4, espn:sync 3,
  // adcc:sync 1, one:sync 1) and none was declared here. They were working and
  // unwatched — so the day one of them stopped, nothing would have said so.
  //
  // Cadences match render.yaml: the promotion loop is Mon/Thu, the daily loop is
  // 04:00, and gf-cron-weekly is Monday.
  {
    route: "refresh-one",
    label: "ONE Championship events",
    targets: ["one:sync"],
    everyMinutes: 5040,
    matters: "ONE cards stop arriving — already the largest coverage gap in the database.",
  },
  {
    route: "refresh-bkfc",
    label: "BKFC events",
    targets: ["bkfc:sync"],
    everyMinutes: 5040,
    matters: "BKFC cards stop arriving.",
  },
  {
    route: "refresh-mma",
    label: "MMA roster (Wikipedia)",
    targets: ["mma:roster"],
    everyMinutes: 1440,
    matters: "New fighters stop being discovered from the roster source.",
  },
  {
    route: "refresh-espn",
    label: "ESPN scoreboard",
    targets: ["espn:sync"],
    everyMinutes: 1440,
    matters: "Full MMA cards and winners for UFC/PFL/Bellator/ONE/RIZIN stop refreshing.",
  },
  {
    route: "refresh-adcc",
    label: "ADCC (BJJ)",
    targets: ["adcc:sync"],
    everyMinutes: 10_080,
    matters: "The only BJJ event source stops.",
  },
];

/** Multiple of the cadence we tolerate before calling a job overdue. */
const GRACE = 2.5;

export type JobState = "ok" | "failing" | "overdue" | "never-run";

export interface JobHealth {
  route: string;
  label: string;
  matters: string;
  everyMinutes: number;
  state: JobState;
  /** Most recent run of ANY of this job's targets. */
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  minutesSinceLastRun: number | null;
  lastError: string | null;
  /** Failed runs out of the last `sampled` for this job. */
  recentFailures: number;
  sampled: number;
}

/**
 * A target the DATABASE has run history for that no expected job claims.
 *
 * This is the diagnostic that separates the two failure modes a `never-run`
 * report cannot distinguish on its own:
 *
 *   the job never fired            → a scheduling problem (fix Render)
 *   the job fired under another name → a BOOKKEEPING problem (fix this list)
 *
 * Without it, renaming a `safe("…")` target silently turns a healthy job into a
 * permanent "never run", and the obvious response — go hunting through Render —
 * is a waste of an afternoon.
 */
export interface UnknownTarget {
  target: string;
  runs: number;
  lastRunAt: string;
}

export interface CronHealthReport {
  generatedAt: string;
  /** True when nothing at all is wrong. */
  healthy: boolean;
  /** The master ingestion gate, because it silently disables most of these. */
  scraperGate: { value: string | null; enabled: boolean; note: string | null };
  jobs: JobHealth[];
  /** Targets with history that no expected job declares. See UnknownTarget. */
  unknownTargets: UnknownTarget[];
}

/** How many recent rows per target to consider when scoring failures. */
const SAMPLE = 20;

export async function auditCronHealth(): Promise<CronHealthReport> {
  const allTargets = EXPECTED_JOBS.flatMap((j) => j.targets);

  // One query, then group in memory: this table is small and indexed on target,
  // but a query per target would be ~16 round trips on a 256MB instance.
  const rows = await prisma.scrapeJob.findMany({
    where: { target: { in: allTargets } },
    select: { target: true, status: true, error: true, startedAt: true, finishedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: SAMPLE * allTargets.length,
  });

  const byTarget = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byTarget.get(r.target) ?? [];
    if (list.length < SAMPLE) list.push(r);
    byTarget.set(r.target, list);
  }

  const now = Date.now();
  const jobs: JobHealth[] = EXPECTED_JOBS.map((job) => {
    const runs = job.targets.flatMap((t) => byTarget.get(t) ?? []);
    runs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const lastRun = runs[0] ?? null;
    const lastSuccess = runs.find((r) => r.status === "SUCCESS") ?? null;
    const lastFailure = runs.find((r) => r.status === "FAILED") ?? null;
    const minutesSince = lastRun ? Math.round((now - lastRun.createdAt.getTime()) / 60_000) : null;
    const recentFailures = runs.filter((r) => r.status === "FAILED").length;

    // Order matters. "never-run" and "overdue" both mean the SCHEDULER is the
    // problem and must outrank "failing", which means the scheduler is fine and
    // the job itself is broken — they send an operator to different places.
    let state: JobState;
    if (!lastRun) state = "never-run";
    else if (minutesSince !== null && minutesSince > job.everyMinutes * GRACE) state = "overdue";
    else if (lastRun.status === "FAILED") state = "failing";
    else state = "ok";

    return {
      route: job.route,
      label: job.label,
      matters: job.matters,
      everyMinutes: job.everyMinutes,
      state,
      lastRunAt: lastRun?.createdAt.toISOString() ?? null,
      lastSuccessAt: lastSuccess?.createdAt.toISOString() ?? null,
      minutesSinceLastRun: minutesSince,
      lastError: lastFailure?.error ?? null,
      recentFailures,
      sampled: runs.length,
    };
  });

  // ── Bookkeeping check ───────────────────────────────────────────────────
  // Which targets does the database have history for that nothing above claims?
  // A `never-run` job with an orphan target sitting beside it is almost always a
  // renamed target, not a dead cron — and those two diagnoses send an operator
  // to completely different places.
  //
  // groupBy over the whole table rather than the `in` filter used above: the
  // point is precisely to see the targets that filter would exclude.
  const seen = new Set(allTargets);
  const grouped = await prisma.scrapeJob
    .groupBy({ by: ["target"], _count: { _all: true }, _max: { createdAt: true } })
    .catch(() => [] as { target: string; _count: { _all: number }; _max: { createdAt: Date | null } }[]);

  const unknownTargets: UnknownTarget[] = grouped
    .filter((g) => !seen.has(g.target))
    .map((g) => ({
      target: g.target,
      runs: g._count._all,
      lastRunAt: (g._max.createdAt ?? new Date(0)).toISOString(),
    }))
    .sort((a, b) => b.lastRunAt.localeCompare(a.lastRunAt));

  return {
    generatedAt: new Date().toISOString(),
    healthy: jobs.every((j) => j.state === "ok"),
    scraperGate: describeScraperGate(),
    jobs,
    unknownTargets,
  };
}

/**
 * Report the ingestion gate verbatim. It is a boolean-ish flag, never a secret,
 * and the exact observed value is the whole diagnosis: `"true"` with quotes, or
 * `True`, or a trailing space, all fail the exact-match check in scraper/http.ts
 * while looking correct in a dashboard.
 */
function describeScraperGate(): CronHealthReport["scraperGate"] {
  const raw = process.env.ENABLE_SCRAPER ?? null;
  if (raw === "true") return { value: raw, enabled: true, note: null };
  if (raw === null) {
    return {
      value: null,
      enabled: false,
      note: "ENABLE_SCRAPER is not set. Wikipedia is the only source of bout results, and it " +
        "reaches the network through the gated fetch — results will never update.",
    };
  }
  const looksIntended = raw.trim().toLowerCase().replace(/^["']|["']$/g, "") === "true";
  return {
    value: raw,
    enabled: false,
    note: looksIntended
      ? `ENABLE_SCRAPER is ${JSON.stringify(raw)} — you meant true, but it must be exactly \`true\`: ` +
        "no quotes, no whitespace, lowercase."
      : `ENABLE_SCRAPER is ${JSON.stringify(raw)}, so all ingestion is disabled, including bout results.`,
  };
}
