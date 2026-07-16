// ════════════════════════════════════════════════════════════════════════
//  Production startup guard — fail closed, loudly, before serving a request.
//
//  Dependency-free by design: this is imported by instrumentation.ts, and anything
//  it pulls in gets bundled into the startup context (where native modules such as
//  sharp cannot resolve `child_process`). Keep it that way.
//
//  Every check here answers the same question: "is there a configuration in which
//  this app would silently do the insecure thing?" If yes, we refuse to start.
//  A crashed deploy is recoverable. A deploy that quietly serves forgeable sessions
//  or publishes passports is not.
// ════════════════════════════════════════════════════════════════════════

import { validateSecret } from "@/lib/auth-secret";
import { assertPrivateBucketConfig } from "@/lib/evidence/config";

export class StartupConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(
      `Refusing to start — insecure or incomplete production configuration:\n` +
        problems.map((p) => `  • ${p}`).join("\n"),
    );
    this.name = "StartupConfigError";
    this.problems = problems;
  }
}

/**
 * Known example/placeholder values shipped in .env.example. If one of these reaches
 * production it means the operator copied the example file and never filled it in.
 */
const PLACEHOLDER_VALUES = new Set([
  "change-me", "changeme", "change_me", "placeholder", "example", "todo",
  "your-secret-here", "xxx", "secret",
]);

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return false;
  return PLACEHOLDER_VALUES.has(value.trim().toLowerCase());
}

/**
 * Collect every production configuration problem. Returns [] when safe.
 *
 * Returns a list rather than throwing on the first fault, so an operator sees all
 * of them in one deploy rather than fixing them one crash at a time.
 *
 * No value is ever echoed — only variable names and the nature of the fault.
 */
export function collectStartupProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  const isProd = env.NODE_ENV === "production";

  // ── Session signing ─────────────────────────────────────────────────────
  const secretProblem = validateSecret(env.AUTH_SECRET);
  if (isProd && secretProblem) {
    problems.push(`${secretProblem} — session cookies would be forgeable. Generate with \`npx auth secret\`.`);
  }

  // ── Cron secret ─────────────────────────────────────────────────────────
  // Cron routes fail closed when it is absent, but a PLACEHOLDER value is worse
  // than absent: it looks configured and is publicly known from .env.example.
  if (isProd && isPlaceholder(env.SCRAPE_CRON_SECRET)) {
    problems.push("SCRAPE_CRON_SECRET is set to a known placeholder value from .env.example. Set a real secret.");
  }

  // ── Private evidence storage ────────────────────────────────────────────
  // In production, identity documents MUST have a private bucket. Without one,
  // putEvidence() refuses every upload — so the claim flow is silently broken.
  // Surface that at boot instead of at the first passport upload.
  if (isProd) {
    const hasEvidenceBucket =
      env.EVIDENCE_R2_ENDPOINT && env.EVIDENCE_R2_BUCKET &&
      env.EVIDENCE_R2_ACCESS_KEY_ID && env.EVIDENCE_R2_SECRET_ACCESS_KEY;
    if (!hasEvidenceBucket) {
      problems.push(
        "Private evidence storage is not configured (EVIDENCE_R2_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY). " +
          "Identity-document upload cannot function, and must never fall back to public storage.",
      );
    }
  }

  // Public-bucket collision / public base URL. Fatal in EVERY environment — this
  // is the mistake that publishes a passport, and it must not be possible to make
  // it in staging either.
  try {
    assertPrivateBucketConfig(env);
  } catch (e) {
    problems.push((e as Error).message);
  }

  // ── Admin bootstrap left armed ──────────────────────────────────────────
  // Bootstrap is a CLI operation. If these are still set on a running web service,
  // the operator forgot to remove them after provisioning — a live admin password
  // sitting in the environment of an internet-facing process.
  if (isProd && (env.BOOTSTRAP_ADMIN_EMAIL || env.BOOTSTRAP_ADMIN_PASSWORD || env.ALLOW_ADMIN_BOOTSTRAP === "true")) {
    problems.push(
      "Admin-bootstrap variables (BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD / ALLOW_ADMIN_BOOTSTRAP) are " +
        "still set on the running service. They are only needed for the one-off `npm run admin:bootstrap` command. " +
        "Remove them.",
    );
  }

  // ── Rate limiting across instances ──────────────────────────────────────
  // The in-memory limiter is per-process. With more than one instance an attacker
  // gets (limit × instances) attempts, so a multi-instance deploy must use Redis.
  const instances = Number(env.WEB_INSTANCE_COUNT ?? "1");
  if (isProd && Number.isFinite(instances) && instances > 1 && !env.RATE_LIMIT_REDIS_URL) {
    problems.push(
      `WEB_INSTANCE_COUNT=${instances} but RATE_LIMIT_REDIS_URL is not set. The in-memory rate limiter is ` +
        "per-process; with multiple instances the login/reset limits would not hold. Configure shared storage.",
    );
  }

  return problems;
}

/** @throws StartupConfigError when the environment is unsafe to serve from. */
export function assertSafeStartup(env: NodeJS.ProcessEnv = process.env): void {
  const problems = collectStartupProblems(env);
  if (problems.length > 0) throw new StartupConfigError(problems);
}
