import "server-only";
import { prisma } from "@/lib/db";
import { flags } from "@/lib/feature-flags";
import { missingLegalFields } from "@/lib/legal-config";
import { isCanonicalHost, SITE } from "@/lib/config";
import { ingestibleSources } from "@/lib/rankings/sources";
import { auditCronHealth } from "./cron-health";
import { getProviderHealth } from "./provider-health";

// ════════════════════════════════════════════════════════════════════════
//  LAUNCH READINESS — one score, from measurements, in one place.
//
//  Composes the health modules that already exist (cron-health,
//  provider-health) and adds the checks that had no home: configuration that is
//  only ever wrong in production (email, storage, legal identity, canonical
//  host) and the data thresholds that decide whether a screen is worth showing.
//
//  THE RULE THIS FILE IS BUILT ON: a check may only report what it MEASURED.
//  Configuration checks read the environment of the process that runs them, so
//  running this locally scores the LOCAL deployment — it cannot tell you whether
//  Render has RESEND_API_KEY set. Every such check is tagged `envScoped`, and
//  the renderer says so, because a green "Email ✅" produced on a laptop is the
//  single most misleading thing this file could emit.
//
//  Severity decides the score:
//    blocker — do not launch. Costs the full weight.
//    warn    — launch is defensible; costs half.
//    info    — recorded, costs nothing.
// ════════════════════════════════════════════════════════════════════════

export type CheckStatus = "pass" | "warn" | "fail" | "unknown";

export interface ReadinessCheck {
  id: string;
  group: string;
  label: string;
  status: CheckStatus;
  /** What was actually measured — a number, a count, a name. Never a guess. */
  detail: string;
  /** What to do about it. Empty when passing. */
  remedy?: string;
  /** Points this check is worth. blocker=10, warn-only=5, info=0. */
  weight: number;
  /**
   * True when the answer depends on the ENVIRONMENT this ran in rather than on
   * the database — so a local run says nothing about production.
   */
  envScoped?: boolean;
}

export interface ReadinessReport {
  generatedAt: string;
  siteUrl: string;
  /** 0–100. Weighted: a failed blocker costs its full weight, a warn half. */
  score: number;
  maxScore: number;
  blockers: ReadinessCheck[];
  checks: ReadinessCheck[];
}

const ok = (
  id: string, group: string, label: string, detail: string, weight = 10, envScoped = false,
): ReadinessCheck => ({ id, group, label, status: "pass", detail, weight, envScoped });

const bad = (
  id: string, group: string, label: string, detail: string, remedy: string,
  status: Exclude<CheckStatus, "pass"> = "fail", weight = 10, envScoped = false,
): ReadinessCheck => ({ id, group, label, status, detail, remedy, weight, envScoped });

/** Truthy-and-not-a-placeholder. */
const set = (v: string | undefined) => Boolean(v && v.trim() && !/^(tbd|todo|changeme|change-me)$/i.test(v.trim()));

export async function auditLaunchReadiness(): Promise<ReadinessReport> {
  const checks: ReadinessCheck[] = [];
  const f = flags();
  const env = process.env;

  // ── Database ───────────────────────────────────────────────────────────
  let fighters = 0, events = 0, upcoming = 0, rankings = 0, champions = 0, withImage = 0;
  try {
    [fighters, events, upcoming, rankings, champions] = await Promise.all([
      prisma.fighter.count(),
      prisma.event.count(),
      prisma.event.count({ where: { date: { gte: new Date() } } }),
      prisma.ranking.count({ where: { source: { not: "generated" } } }),
      prisma.champion.count({ where: { current: true } }),
    ]);
    withImage = await prisma.fighter.count({ where: { OR: [{ imageUrl: { not: null } }, { thumbUrl: { not: null } }] } });
    checks.push(ok("db", "Infrastructure", "Database", `reachable — ${fighters} fighters, ${events} events`));
  } catch (e) {
    checks.push(bad("db", "Infrastructure", "Database", `unreachable: ${(e as Error).message}`,
      "Nothing below this line can be trusted. Fix DATABASE_URL first."));
    return finish(checks);
  }

  // ── Cache / Redis ──────────────────────────────────────────────────────
  // Not a blocker: cache.ts falls back to an in-process Map by design. It is a
  // warning because that fallback is per-instance, so it stops being a cache the
  // moment the service scales past one container.
  checks.push(set(env.REDIS_URL)
    ? ok("redis", "Infrastructure", "Redis cache", "REDIS_URL set", 5, true)
    : bad("redis", "Infrastructure", "Redis cache", "REDIS_URL unset — in-process Map fallback",
      "Fine on a single instance. Set REDIS_URL before scaling past one container.", "warn", 5, true));

  // ── Email — password reset is dead without it ───────────────────────────
  const emailReady = set(env.EMAIL_PROVIDER) && set(env.RESEND_API_KEY) && set(env.EMAIL_FROM);
  const sandboxSender = /@resend\.dev$/i.test(env.EMAIL_FROM ?? "");
  checks.push(
    !emailReady
      ? bad("email", "Infrastructure", "Transactional email",
        "EMAIL_PROVIDER / RESEND_API_KEY / EMAIL_FROM not all set",
        "PASSWORD RESET IS DEAD. /api/auth/password/reset/request answers 503 by design rather than mint a token nobody receives.", "fail", 10, true)
      : sandboxSender
        ? bad("email", "Infrastructure", "Transactional email",
          `EMAIL_FROM is ${env.EMAIL_FROM} — Resend's SANDBOX sender`,
          "It can only deliver to the Resend account owner. Every other user is rejected, and the reset route returns the same message either way — so this looks EXACTLY like working password reset while locking out every real user.", "fail", 10, true)
        : ok("email", "Infrastructure", "Transactional email", `${env.EMAIL_PROVIDER} via ${env.EMAIL_FROM}`, 10, true),
  );

  // ── Object storage — uploads silently vanish without it ────────────────
  const storageReady = set(env.BLOB_READ_WRITE_TOKEN) ||
    (set(env.R2_BUCKET) && set(env.R2_ENDPOINT) && set(env.R2_ACCESS_KEY_ID) && set(env.R2_SECRET_ACCESS_KEY));
  checks.push(storageReady
    ? ok("storage", "Infrastructure", "Object storage", set(env.BLOB_READ_WRITE_TOKEN) ? "Vercel Blob" : "R2/S3", 10, true)
    : bad("storage", "Infrastructure", "Object storage", "no Blob token and no complete R2 credential set",
      "images/store.ts falls back to LOCAL DISK, which on Render is EPHEMERAL. The upload succeeds, the user sees their picture, and it disappears at the next deploy. That is worse than a refusal because it looks like it worked.", "fail", 10, true));

  // Identity documents must never share the public bucket.
  const evidenceReady = set(env.EVIDENCE_R2_BUCKET) && set(env.EVIDENCE_R2_ENDPOINT) &&
    set(env.EVIDENCE_R2_ACCESS_KEY_ID) && set(env.EVIDENCE_R2_SECRET_ACCESS_KEY);
  checks.push(evidenceReady
    ? ok("evidence", "Infrastructure", "Private evidence storage", "configured", 10, true)
    : bad("evidence", "Infrastructure", "Private evidence storage", "EVIDENCE_R2_* incomplete",
      "startup-guard REFUSES TO BOOT without these, so the service never listens and the health check times out. Set all four, to a bucket that is NOT R2_BUCKET.", "fail", 10, true));

  // ── SEO / canonical host ───────────────────────────────────────────────
  checks.push(isCanonicalHost()
    ? ok("canonical", "SEO", "Canonical host", SITE.url, 10, true)
    : bad("canonical", "SEO", "Canonical host", `NEXT_PUBLIC_SITE_URL unset — falling back to ${SITE.url}`,
      "robots.txt serves `Disallow: /` and every page is noindex. Deliberate (being unindexed is recoverable; being indexed under a dead host is not) — but the site will not be indexed AT ALL until this is set.", "fail", 10, true));

  // ── Legal identity ─────────────────────────────────────────────────────
  const missingLegal = missingLegalFields();
  checks.push(missingLegal.length === 0
    ? ok("legal", "Legal", "Legal identity", "all fields set", 10, true)
    : bad("legal", "Legal", "Legal identity", `${missingLegal.length} unset: ${missingLegal.join(", ")}`,
      "/privacy, /terms and /cookies publish placeholder text saying they 'must not be relied upon'. A privacy notice must be published BEFORE personal data is collected, and sign-up already collects an email.", "fail", 10, true));

  // ── Demo data ──────────────────────────────────────────────────────────
  const seedUsers = await prisma.user.count({ where: { email: { endsWith: "@seed.local" } } });
  checks.push(seedUsers === 0
    ? ok("seed", "Data", "Demo data purged", "no @seed.local accounts")
    : bad("seed", "Data", "Demo data purged", `${seedUsers} simulated accounts present`,
      "Set ALLOW_SEED_WORLD to false (or delete it) and redeploy — the next boot purges every @seed.local account and everything it owns.", "fail"));

  // ── Rankings ───────────────────────────────────────────────────────────
  const licensed = ingestibleSources();
  checks.push(!f.rankingsEnabled
    ? bad("rankings-serve", "Rankings", "Rankings served", "RANKINGS_ENABLED is not \"true\"",
      "/rankings, /p4p and /champions all refuse. Set it to enable them.", "warn", 5, true)
    : rankings === 0
      ? bad("rankings-serve", "Rankings", "Rankings served", "enabled, but 0 publishable ranking rows",
        "Every rankings page renders its empty state. Run `npm run rankings:ingest -- --apply`.", "fail")
      : ok("rankings-serve", "Rankings", "Rankings served", `${rankings} publishable rows across ${licensed.length} licensed source(s)`));

  checks.push(champions > 0
    ? ok("champions", "Rankings", "Champions", `${champions} current titleholders`, 5)
    : bad("champions", "Rankings", "Champions", "0 current champions",
      "/champions renders empty. Champions are written by the ranking connectors from rank-0 rows.", "warn", 5));

  // ── Images ─────────────────────────────────────────────────────────────
  // A warning, never a blocker: no provider has a photo for every fighter, and
  // the app renders a designed no-photo state rather than a broken image.
  const imagePct = fighters ? Math.round((withImage / fighters) * 100) : 0;
  checks.push(imagePct >= 25
    ? ok("images", "Data", "Fighter photos", `${imagePct}% of ${fighters} fighters`, 5)
    : bad("images", "Data", "Fighter photos", `${imagePct}% of ${fighters} fighters`,
      "Raise ENRICH_BATCH and the hourly enrichment cron. Not a launch blocker — the no-photo state is designed.", "warn", 5));

  // ── Upcoming events — the front page's whole job ────────────────────────
  checks.push(upcoming > 0
    ? ok("upcoming", "Data", "Upcoming events", `${upcoming} scheduled`)
    : bad("upcoming", "Data", "Upcoming events", "none",
      "Every schedule surface renders empty. Check gf-cron-daily (refresh-events / refresh-espn).", "fail"));

  // ── Providers ──────────────────────────────────────────────────────────
  try {
    const ph = await getProviderHealth();
    const broken = ph.providers.filter((p) => p.state === "silent" || p.state === "never-run");
    checks.push(!ph.scraperEnabled
      ? bad("providers", "Providers", "Ingestion", "ENABLE_SCRAPER is not \"true\"",
        "NOTHING reaches the network. Bout results in particular never update — Wikipedia is the only source that carries them.", "fail", 10, true)
      : broken.length === 0
        ? ok("providers", "Providers", "Ingestion", `${ph.providers.length} providers, none silent`)
        : bad("providers", "Providers", "Ingestion", `${broken.length} silent/never-run: ${broken.map((p) => p.source).join(", ")}`,
          "Run `npm run audit:providers` for the per-source ladder.", "warn", 5));
  } catch (e) {
    checks.push(bad("providers", "Providers", "Ingestion", `health check threw: ${(e as Error).message}`, "Investigate provider-health.ts.", "warn", 5));
  }

  // ── Cron ───────────────────────────────────────────────────────────────
  try {
    const ch = await auditCronHealth();
    const failing = ch.jobs.filter((j) => j.state === "failing");
    const never = ch.jobs.filter((j) => j.state === "never-run");
    checks.push(ch.healthy
      ? ok("cron", "Cron", "Scheduled jobs", `${ch.jobs.length} jobs, all healthy`)
      : bad("cron", "Cron", "Scheduled jobs",
        `${failing.length} failing, ${never.length} never run (of ${ch.jobs.length})`,
        "Run `npm run cron:doctor` for the per-job detail, and `npm run audit:crons` to confirm every route has a schedule.",
        failing.length > 0 || never.length > 0 ? "fail" : "warn"));
  } catch (e) {
    checks.push(bad("cron", "Cron", "Scheduled jobs", `health check threw: ${(e as Error).message}`, "Investigate cron-health.ts.", "warn", 5));
  }

  return finish(checks);
}

function finish(checks: ReadinessCheck[]): ReadinessReport {
  const scored = checks.filter((c) => c.weight > 0);
  const maxScore = scored.reduce((n, c) => n + c.weight, 0);
  const lost = scored.reduce((n, c) => {
    if (c.status === "pass") return n;
    if (c.status === "warn") return n + c.weight / 2;
    return n + c.weight; // fail or unknown — an unmeasured check is not a passing one
  }, 0);
  return {
    generatedAt: new Date().toISOString(),
    siteUrl: SITE.url,
    score: maxScore === 0 ? 0 : Math.round(((maxScore - lost) / maxScore) * 100),
    maxScore,
    blockers: checks.filter((c) => c.status === "fail"),
    checks,
  };
}
