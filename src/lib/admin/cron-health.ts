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
    targets: ["wikicards"],
    everyMinutes: 5040,
    matters: "Events exist with no bouts on them.",
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

export interface CronHealthReport {
  generatedAt: string;
  /** True when nothing at all is wrong. */
  healthy: boolean;
  /** The master ingestion gate, because it silently disables most of these. */
  scraperGate: { value: string | null; enabled: boolean; note: string | null };
  jobs: JobHealth[];
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

  return {
    generatedAt: new Date().toISOString(),
    healthy: jobs.every((j) => j.state === "ok"),
    scraperGate: describeScraperGate(),
    jobs,
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
