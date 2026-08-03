// THE one command.
//
//   npm run doctor:production
//   npm run doctor:production -- --json
//
// Read-only. Composes lib/admin/launch-readiness, which in turn composes the
// cron and provider health modules — so this and /admin/health can never
// disagree about whether the platform is ready.
//
// It always prints WHICH DATABASE and WHICH ENVIRONMENT it read, because the
// fastest way to a confident wrong answer is scoring the wrong deployment. Half
// these checks read process.env, so a run on a laptop scores the LAPTOP; those
// are marked `env` in the output and called out in the footer.
import { auditLaunchReadiness, type ReadinessCheck } from "../src/lib/admin/launch-readiness.ts";
import { prisma } from "../src/lib/db.ts";

const asJson = process.argv.includes("--json");

function target(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) return "(DATABASE_URL not set)";
  try {
    const u = new URL(raw);
    return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

const report = await auditLaunchReadiness();

if (asJson) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  await prisma.$disconnect();
  process.exit(report.blockers.length === 0 ? 0 : 1);
}

const ICON: Record<ReadinessCheck["status"], string> = {
  pass: "OK  ", warn: "WARN", fail: "FAIL", unknown: "??  ",
};

process.stdout.write(`\nPRODUCTION DOCTOR\n${"═".repeat(78)}\n`);
process.stdout.write(`database    ${target()}\n`);
process.stdout.write(`NODE_ENV    ${process.env.NODE_ENV ?? "(unset)"}\n`);
process.stdout.write(`site url    ${report.siteUrl}\n`);
process.stdout.write(`generated   ${report.generatedAt.slice(0, 19)}Z\n`);

let group = "";
for (const c of report.checks) {
  if (c.group !== group) {
    group = c.group;
    process.stdout.write(`\n${group}\n${"─".repeat(78)}\n`);
  }
  process.stdout.write(`  ${ICON[c.status]}  ${c.label.padEnd(26)} ${c.detail}${c.envScoped ? "   [env]" : ""}\n`);
  if (c.remedy) process.stdout.write(`        └─ ${c.remedy}\n`);
}

process.stdout.write(`\n${"═".repeat(78)}\n`);
process.stdout.write(`LAUNCH SCORE   ${report.score}/100\n`);

if (report.blockers.length > 0) {
  process.stdout.write(`\n${report.blockers.length} BLOCKER(S) — do not launch until these are green:\n`);
  report.blockers.forEach((b, i) => process.stdout.write(`  ${String(i + 1).padStart(2)}. ${b.label} — ${b.detail}\n`));
} else {
  process.stdout.write(`\nNo blockers.\n`);
}

// The caveat, always, and last — where it is read.
if (report.checks.some((c) => c.envScoped)) {
  process.stdout.write(
    `\n[env] marks a check that read THIS PROCESS'S environment, not the database.\n` +
    `      A run outside production says nothing about production for those rows.\n` +
    `      Run this in the Render Shell for an answer about the live deployment.\n`,
  );
}

await prisma.$disconnect();
process.exit(report.blockers.length === 0 ? 0 : 1);
