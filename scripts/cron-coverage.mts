// Does every cron ROUTE actually have a SCHEDULE?
//
//   npm run audit:crons
//
// Static. No database, no network — it reads the filesystem and render.yaml, so
// it runs in CI and on a laptop with nothing provisioned.
//
// This is the complement to `cron:doctor`, not a duplicate of it. cron:doctor
// reads ScrapeJob rows and answers "did the scheduled jobs succeed?" — a
// question that can only be asked about a job which is scheduled at all. The
// failure this catches is the one BELOW that: a route that was written, merged,
// deployed and then never wired to a cron service. It does not fail, it does not
// appear as a red job, and it writes no row for cron:doctor to find. It is
// simply never called, and the feature it feeds looks like a data problem
// forever.
//
// That was not hypothetical. When this check was first written, 7 of 22 routes
// had no schedule — including the ESPN results provider, the champions writer,
// and the identity-document retention sweep.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROUTES_DIR = join("src", "app", "api", "cron");
const BLUEPRINT = "render.yaml";

/**
 * Routes that are deliberately unscheduled. An entry here is a claim that the
 * route SHOULD never run, and it must say why — silence is how a real gap gets
 * mistaken for an intentional one.
 */
const INTENTIONALLY_UNSCHEDULED: Record<string, string> = {
  "refresh-people": "Retired no-op — its BoxRec source was removed; the route is kept only so the schedule stays stable.",
};

if (!existsSync(ROUTES_DIR)) {
  process.stdout.write(`No cron routes directory at ${ROUTES_DIR}\n`);
  process.exit(0);
}

const routes = readdirSync(ROUTES_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(ROUTES_DIR, e.name, "route.ts")))
  .map((e) => e.name)
  .sort();

const blueprint = readFileSync(BLUEPRINT, "utf8");

// A route counts as scheduled if its name appears in a curl URL, or as a word in
// a `for p in …` list. Both forms are used in render.yaml and both are real.
function isScheduled(route: string): boolean {
  if (blueprint.includes(`/api/cron/${route}`)) return true;
  return new RegExp(`for p in [^;]*\\b${route}\\b`).test(blueprint);
}

const missing = routes.filter((r) => !isScheduled(r) && !(r in INTENTIONALLY_UNSCHEDULED));
const excused = routes.filter((r) => !isScheduled(r) && r in INTENTIONALLY_UNSCHEDULED);
const scheduled = routes.filter(isScheduled);

process.stdout.write(`\nCRON COVERAGE — ${routes.length} route(s) under ${ROUTES_DIR}\n`);
process.stdout.write(`${"─".repeat(78)}\n`);
for (const r of scheduled) process.stdout.write(`  ok        ${r}\n`);
for (const r of excused) process.stdout.write(`  excused   ${r}  — ${INTENTIONALLY_UNSCHEDULED[r]}\n`);
for (const r of missing) process.stdout.write(`  NO CRON   ${r}\n`);
process.stdout.write(`${"─".repeat(78)}\n`);

// A schedule with no route is the mirror-image bug: the cron fires, curl gets a
// 404, and `|| true` swallows it.
const referenced = [...blueprint.matchAll(/\/api\/cron\/([a-z0-9-]+)/g)].map((m) => m[1]);
const dangling = [...new Set(referenced)].filter((r) => !routes.includes(r));
for (const r of dangling) process.stdout.write(`  NO ROUTE  ${r} is scheduled in ${BLUEPRINT} but has no route.ts\n`);

if (missing.length === 0 && dangling.length === 0) {
  process.stdout.write(`\nEvery cron route has a schedule.\n`);
  process.exit(0);
}
process.stdout.write(
  `\n${missing.length} route(s) will never run; ${dangling.length} schedule(s) point at nothing.\n`,
);
process.exit(1);
