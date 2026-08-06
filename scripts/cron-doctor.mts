// Cron doctor — answers "is the scheduler actually working?" with data.
//
//   npm run cron:doctor            # every expected job, oldest problem first
//   npm run cron:doctor -- --all   # include the jobs that are fine
//
// Point it at production by exporting DATABASE_URL first; the banner below always
// says which database it read, because diagnosing the wrong one is the fastest way
// to reach a confident wrong conclusion.
//
// Why this exists: every scheduled run already wrote a ScrapeJob row, and nothing
// ever read them. The results pipeline was dead in production for weeks — the
// hourly job fired, the Wikipedia fetch threw because ENABLE_SCRAPER was "false",
// the route answered 200 `ok:true`, and `curl -fsS` in render.yaml therefore saw a
// green run. The database held 100% FAILED rows the entire time.
//
// Read-only. It changes nothing.
import { prisma } from "../src/lib/db.ts";
import { auditCronHealth, type JobHealth } from "../src/lib/admin/cron-health.ts";

const showAll = process.argv.slice(2).includes("--all");

function redactedDbTarget(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) return "(DATABASE_URL not set)";
  try {
    const u = new URL(raw);
    return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

const ICON: Record<JobHealth["state"], string> = {
  ok: "✓",
  failing: "✗",
  overdue: "⏱",
  "never-run": "∅",
};

// What to DO about each state. A status word with no next action is the thing that
// made the old dashboard useless.
const ADVICE: Record<JobHealth["state"], string> = {
  ok: "",
  failing: "The scheduler fired and the job threw. Read the error below — fix the job.",
  overdue: "The scheduler did NOT fire on time. Check the cron service in Render, not the code.",
  "never-run": "No run has EVER been recorded. The cron service is missing, misnamed, or 401ing.",
};

function since(minutes: number | null): string {
  if (minutes === null) return "never";
  if (minutes < 60) return `${minutes}m ago`;
  const h = Math.floor(minutes / 60);
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

async function main() {
  console.log(`\nDatabase: ${redactedDbTarget()}`);

  const report = await auditCronHealth();

  // The gate first. When it is closed most rows fail for that single reason, and
  // reading eight copies of the same error is slower than reading this line.
  const gate = report.scraperGate;
  console.log(`Ingestion gate: ENABLE_SCRAPER=${gate.value === null ? "(unset)" : JSON.stringify(gate.value)} → ${gate.enabled ? "OPEN" : "CLOSED"}`);
  if (gate.note) console.log(`  ⚠ ${gate.note}`);

  const problems = report.jobs.filter((j) => j.state !== "ok");
  const shown = showAll ? report.jobs : problems;

  console.log(`\n${report.jobs.length} expected jobs · ${problems.length} need attention\n`);

  // ── Orphan targets ──────────────────────────────────────────────────────
  // Printed BEFORE the job list, because it changes how the list should be
  // read. A job reporting `never-run` next to an orphan target with hundreds of
  // runs is not a dead cron — it is a renamed target, and the fix is one line in
  // EXPECTED_JOBS rather than an afternoon in the Render dashboard.
  if (report.unknownTargets.length) {
    console.log("Run history exists for targets no expected job declares:\n");
    for (const u of report.unknownTargets) {
      console.log(`  ?  ${u.target}  ·  ${u.runs} run(s)  ·  last ${u.lastRunAt.slice(0, 16).replace("T", " ")}`);
    }
    console.log("\n  If one of these looks like a job reported below as never-run, the target");
    console.log("  was renamed — fix EXPECTED_JOBS in lib/admin/cron-health.ts, not Render.\n");
  }

  if (!shown.length) {
    console.log("Every scheduled job has run recently and succeeded.\n");
    return;
  }

  // Worst first: a job that never ran outranks one that is merely late, which
  // outranks one that is firing but broken.
  const rank: Record<JobHealth["state"], number> = { "never-run": 0, overdue: 1, failing: 2, ok: 3 };
  shown.sort((a, b) => rank[a.state] - rank[b.state]);

  for (const j of shown) {
    console.log(`${ICON[j.state]} ${j.label}  (/api/cron/${j.route})`);
    console.log(`    cadence: every ${j.everyMinutes}m · last run: ${since(j.minutesSinceLastRun)} · recent failures: ${j.recentFailures}/${j.sampled}`);
    if (j.state !== "ok") {
      console.log(`    impact:  ${j.matters}`);
      console.log(`    action:  ${ADVICE[j.state]}`);
    }
    if (j.lastError) console.log(`    error:   ${j.lastError}`);
    console.log();
  }

  if (!showAll && problems.length < report.jobs.length) {
    console.log(`(${report.jobs.length - problems.length} healthy job(s) hidden — pass --all to see them.)\n`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
