// ════════════════════════════════════════════════════════════════════════════
//  RELEASE DOCTOR — every preflight that can be answered WITHOUT a database.
//
//   npm run release:doctor
//   npm run release:doctor -- --json
//
//  ── How this differs from `doctor:production` ────────────────────────────
//  `doctor:production` composes lib/admin/launch-readiness and needs Postgres:
//  it answers "is the PLATFORM ready" (are there events, are the crons alive,
//  are there ranking rows). This answers "is the RELEASE ready" — configuration,
//  the Android package, the policy switches, the repository itself — and needs
//  nothing but a filesystem and an environment. That split is the point: this
//  one can run in CI, on a laptop, and in the Render Shell, and the two never
//  duplicate a check.
//
//  ── The rule ─────────────────────────────────────────────────────────────
//  A check may only report what it MEASURED. Nothing here infers, and nothing
//  prints a tick it did not earn. Checks that read `process.env` are marked
//  [env] and say so in the footer, because a green row produced on a laptop
//  says nothing about Render.
//
//  Exit code is 1 if any BLOCKER fails, so it can gate a release script.
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LEGAL_FIELDS, isPlaceholder } from "../src/lib/legal-config.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const asJson = process.argv.includes("--json");
const env = process.env;

type Level = "blocker" | "warn" | "info";
type State = "pass" | "fail" | "skip";

interface Check {
  group: string;
  label: string;
  state: State;
  level: Level;
  /** What was actually measured. Never a guess. */
  detail: string;
  remedy?: string;
  envScoped?: boolean;
}

const checks: Check[] = [];
const add = (c: Check) => checks.push(c);
const set = (v: string | undefined) =>
  Boolean(v && v.trim() && !/^(tbd|todo|changeme|change-me)$/i.test(v.trim()));

// ── 1. The production origin ───────────────────────────────────────────────
// Everything else about a TWA hangs off this one value, and every way it can be
// wrong is silent: a wrong origin ships an app that opens a Chrome tab with a
// URL bar, and an unset one leaves the whole site `noindex` behind
// `robots: Disallow: /`.
const siteUrl = (env.NEXT_PUBLIC_SITE_URL ?? "").trim();
if (!set(siteUrl)) {
  add({
    group: "Origin", label: "NEXT_PUBLIC_SITE_URL", state: "fail", level: "blocker", envScoped: true,
    detail: "unset",
    remedy: "The app's canonical origin. Unset means robots.txt serves `Disallow: /`, every page is noindex, and `npm run android:manifest` refuses to build. Set the FULL origin including https://.",
  });
} else {
  let u: URL | null = null;
  try { u = new URL(siteUrl); } catch { /* handled below */ }
  if (!u) {
    add({ group: "Origin", label: "NEXT_PUBLIC_SITE_URL", state: "fail", level: "blocker", envScoped: true,
      detail: `not a URL: ${siteUrl}`, remedy: "Must parse as a URL, scheme included." });
  } else if (u.protocol !== "https:") {
    add({ group: "Origin", label: "NEXT_PUBLIC_SITE_URL", state: "fail", level: "blocker", envScoped: true,
      detail: `${u.protocol} — not https`,
      remedy: "A Trusted Web Activity cannot verify over http, and Play blocks cleartext traffic by default." });
  } else if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(u.hostname) || u.hostname.endsWith(".local")) {
    add({ group: "Origin", label: "NEXT_PUBLIC_SITE_URL", state: "fail", level: "blocker", envScoped: true,
      detail: `points at a local host: ${u.hostname}`,
      remedy: "A release artifact built against localhost installs and then opens nothing." });
  } else {
    add({ group: "Origin", label: "NEXT_PUBLIC_SITE_URL", state: "pass", level: "blocker", envScoped: true,
      detail: u.origin });
    // APP_HOST is what the cron jobs curl. It is a HOST, not an origin, and the
    // two drifting apart is invisible until a cron silently stops firing.
    const appHost = (env.APP_HOST ?? "").trim();
    if (!set(appHost)) {
      add({ group: "Origin", label: "APP_HOST", state: "fail", level: "warn", envScoped: true,
        detail: "unset", remedy: "The host the cron jobs call. Host only, no scheme." });
    } else if (appHost !== u.host) {
      add({ group: "Origin", label: "APP_HOST", state: "fail", level: "blocker", envScoped: true,
        detail: `${appHost} ≠ ${u.host}`,
        remedy: "APP_HOST and NEXT_PUBLIC_SITE_URL name different hosts. One of them is stale, and the crons are calling whichever it is." });
    } else {
      add({ group: "Origin", label: "APP_HOST", state: "pass", level: "warn", envScoped: true, detail: appHost });
    }
  }
}

// ── 2. Digital Asset Links ─────────────────────────────────────────────────
const pkg = (env.TWA_PACKAGE_NAME ?? "").trim();
const fingerprintsRaw = (env.TWA_SHA256_FINGERPRINTS ?? "").trim();

if (!set(pkg)) {
  add({ group: "Android", label: "TWA_PACKAGE_NAME", state: "fail", level: "blocker", envScoped: true,
    detail: "unset",
    remedy: "/.well-known/assetlinks.json answers 404 without it, so the app opens with a URL BAR. Permanent once published." });
} else if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(pkg)) {
  add({ group: "Android", label: "TWA_PACKAGE_NAME", state: "fail", level: "blocker", envScoped: true,
    detail: `invalid application id: ${pkg}`,
    remedy: "Lower-case, two or more dot-separated segments, each starting with a letter." });
} else {
  add({ group: "Android", label: "TWA_PACKAGE_NAME", state: "pass", level: "blocker", envScoped: true, detail: pkg });
}

// A SHA-256 certificate fingerprint is 32 colon-separated hex octets. Checking
// the SHAPE catches the two mistakes that actually happen — pasting the SHA-1
// row from the same keytool output, and pasting only one of the two keys.
const FINGERPRINT_RE = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;
if (!set(fingerprintsRaw)) {
  add({ group: "Android", label: "TWA_SHA256_FINGERPRINTS", state: "fail", level: "blocker", envScoped: true,
    detail: "unset",
    remedy: "Needs BOTH the upload key and the Play App Signing key, comma-separated. Play re-signs your upload, so the production fingerprint is NOT your keystore's." });
} else {
  const fps = fingerprintsRaw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const malformed = fps.filter((f) => !FINGERPRINT_RE.test(f));
  if (malformed.length) {
    add({ group: "Android", label: "TWA_SHA256_FINGERPRINTS", state: "fail", level: "blocker", envScoped: true,
      detail: `${malformed.length} of ${fps.length} are not SHA-256 fingerprints`,
      remedy: "Expected 32 colon-separated hex octets each. A 20-octet value is the SHA-1 line from the same keytool output — the wrong row." });
  } else if (fps.length < 2) {
    add({ group: "Android", label: "TWA_SHA256_FINGERPRINTS", state: "fail", level: "warn", envScoped: true,
      detail: "only 1 fingerprint",
      remedy: "You almost always need two: the upload key AND the Play App Signing key (Play Console → Setup → App integrity). With one, either internal-testing builds or production builds will show a URL bar — and which one depends on which key you listed." });
  } else {
    add({ group: "Android", label: "TWA_SHA256_FINGERPRINTS", state: "pass", level: "blocker", envScoped: true,
      detail: `${fps.length} fingerprints, all well-formed` });
  }
}

// ── 3. The Android version ─────────────────────────────────────────────────
const versionPath = join(ROOT, "android", "version.json");
if (!existsSync(versionPath)) {
  add({ group: "Android", label: "android/version.json", state: "fail", level: "blocker",
    detail: "missing", remedy: "Restore it — `npm run android:bump` reads and writes it." });
} else {
  try {
    const v = JSON.parse(readFileSync(versionPath, "utf8")) as { versionName?: unknown; versionCode?: unknown };
    const codeOk = Number.isInteger(v.versionCode) && (v.versionCode as number) >= 1;
    const nameOk = typeof v.versionName === "string" && /^\d+\.\d+\.\d+$/.test(v.versionName);
    add(codeOk && nameOk
      ? { group: "Android", label: "Version", state: "pass", level: "blocker",
          detail: `${v.versionName} (code ${v.versionCode})` }
      : { group: "Android", label: "Version", state: "fail", level: "blocker",
          detail: `versionName=${String(v.versionName)} versionCode=${String(v.versionCode)}`,
          remedy: "versionName must be MAJOR.MINOR.PATCH and versionCode a positive integer." });
  } catch (e) {
    add({ group: "Android", label: "android/version.json", state: "fail", level: "blocker",
      detail: `unparseable: ${(e as Error).message}` });
  }
}

// The generated Bubblewrap manifest, when it exists, must agree with the
// environment it will be submitted against. It is gitignored, so its absence is
// normal — but a STALE one built against a different origin or package is the
// exact artefact that produces a URL bar nobody can explain.
const twaPath = join(ROOT, "android", "twa-manifest.json");
if (!existsSync(twaPath)) {
  add({ group: "Android", label: "twa-manifest.json", state: "skip", level: "info",
    detail: "not generated yet",
    remedy: "Run `npm run android:manifest` before `bubblewrap build`." });
} else {
  try {
    const m = JSON.parse(readFileSync(twaPath, "utf8")) as Record<string, string>;
    const problems: string[] = [];
    if (set(pkg) && m.packageId !== pkg) problems.push(`packageId ${m.packageId} ≠ TWA_PACKAGE_NAME ${pkg}`);
    if (set(siteUrl)) {
      try {
        const host = new URL(siteUrl).host;
        if (m.host !== host) problems.push(`host ${m.host} ≠ ${host}`);
      } catch { /* origin already reported above */ }
    }
    if (/localhost|127\.0\.0\.1|example\.(test|com|invalid)/i.test(JSON.stringify(m))) {
      problems.push("contains a localhost/example URL");
    }
    add(problems.length === 0
      ? { group: "Android", label: "twa-manifest.json", state: "pass", level: "blocker",
          detail: `${m.packageId} @ ${m.host} v${m.appVersionName} (code ${m.appVersionCode})` }
      : { group: "Android", label: "twa-manifest.json", state: "fail", level: "blocker",
          detail: problems.join("; "),
          remedy: "STALE ARTEFACT. Regenerate with `npm run android:manifest` against the production environment." });
  } catch (e) {
    add({ group: "Android", label: "twa-manifest.json", state: "fail", level: "blocker",
      detail: `unparseable: ${(e as Error).message}` });
  }
}

// ── 4. targetSdkVersion — a HARD, DATED Play requirement ───────────────────
// Verified against Google's own documentation, not from memory: from
// 31 August 2026, new apps AND updates must target Android 16 (API 36).
// Bubblewrap sets this from its own template, so it is a property of the CLI
// version you built with — which is why this reads the GENERATED project rather
// than asserting anything about the repo.
const REQUIRED_TARGET_SDK = 36;
const gradlePath = join(ROOT, "android", "app", "build.gradle");
if (!existsSync(gradlePath)) {
  add({ group: "Android", label: `targetSdk ≥ ${REQUIRED_TARGET_SDK}`, state: "skip", level: "info",
    detail: "android/app/build.gradle not generated yet",
    remedy: `Re-run after \`bubblewrap init\`. From 2026-08-31 Play rejects uploads targeting below API ${REQUIRED_TARGET_SDK}; Bubblewrap's value comes from the CLI version, so update the CLI (\`npm i -g @bubblewrap/cli\`) if it is lower.` });
} else {
  const gradle = readFileSync(gradlePath, "utf8");
  const found = /targetSdk(?:Version)?\s*=?\s*(\d+)/.exec(gradle);
  const target = found ? Number(found[1]) : null;
  add(target !== null && target >= REQUIRED_TARGET_SDK
    ? { group: "Android", label: `targetSdk ≥ ${REQUIRED_TARGET_SDK}`, state: "pass", level: "blocker",
        detail: `targetSdk ${target}` }
    : { group: "Android", label: `targetSdk ≥ ${REQUIRED_TARGET_SDK}`, state: "fail", level: "blocker",
        detail: target === null ? "could not read targetSdk from build.gradle" : `targetSdk ${target}`,
        remedy: `Play rejects uploads below API ${REQUIRED_TARGET_SDK} from 2026-08-31. Update Bubblewrap (\`npm i -g @bubblewrap/cli\`) and re-run \`bubblewrap update\`, or raise it in android/app/build.gradle.` });
}

// ── 5. Legal identity ──────────────────────────────────────────────────────
const missingLegal = LEGAL_FIELDS.filter((f) => isPlaceholder(env[f]));
add(missingLegal.length === 0
  ? { group: "Legal", label: "Legal identity", state: "pass", level: "blocker", envScoped: true,
      detail: `all ${LEGAL_FIELDS.length} set` }
  : { group: "Legal", label: "Legal identity", state: "fail", level: "blocker", envScoped: true,
      detail: `${missingLegal.length} unset: ${missingLegal.join(", ")}`,
      remedy: "/privacy, /terms and /cookies publish placeholder text saying they must not be relied upon. Play requires a privacy policy URL that resolves and describes the app." });

// ── 6. Policy switches that must be OFF for a Play build ───────────────────
// Verified: displaying odds for information is not gambling. Emitting an
// outbound link to Polymarket or Kalshi sends a user to a REAL-MONEY venue,
// which changes what the app is under Play's Real-Money Gambling policy.
const DANGEROUS = [
  ["TRADING_LINKS_ENABLED", "emits OUTBOUND links to a real-money prediction market (Polymarket / Kalshi)"],
  ["POLYMARKET_ENABLED", "ingests Polymarket; their consumer ToS bars commercial use and public display"],
  ["KALSHI_ENABLED", "ingests Kalshi market data"],
  ["MARKET_PRICES_ENABLED", "renders market prices anywhere in the UI or API"],
] as const;
const armed = DANGEROUS.filter(([k]) => (env[k] ?? "").trim().toLowerCase() === "true");
add(armed.length === 0
  ? { group: "Policy", label: "Real-money flags", state: "pass", level: "blocker", envScoped: true,
      detail: "all four off (fail-closed defaults)" }
  : { group: "Policy", label: "Real-money flags", state: "fail", level: "blocker", envScoped: true,
      detail: armed.map(([k, why]) => `${k} — ${why}`).join("; "),
      remedy: "Turn these off for a Play build, or take Play's Real-Money Gambling declaration deliberately (separate declaration + country allow-list). Do not ship them on by accident." });

// Demo data must never reach a store build.
add((env.SEED_WORLD_MODE ?? "off").trim().toLowerCase() === "off" || !set(env.SEED_WORLD_MODE)
  ? { group: "Policy", label: "Seed world", state: "pass", level: "blocker", envScoped: true, detail: "off" }
  : { group: "Policy", label: "Seed world", state: "fail", level: "blocker", envScoped: true,
      detail: `SEED_WORLD_MODE=${env.SEED_WORLD_MODE}`,
      remedy: "Simulated accounts and predictions would be live in the store build. Set it to off and redeploy." });

// ── 7. Media uploads must never outrun the scanner ─────────────────────────
// The architecture fails closed on purpose. This asserts nobody has opened the
// gate without provisioning what the gate exists to wait for.
const uploadsOn = (env.UGC_MEDIA_UPLOADS_ENABLED ?? "").trim().toLowerCase() === "true";
const scannerConfigured = set(env.MEDIA_SCAN_URL) || set(env.CLAMAV_HOST) || set(env.MEDIA_SCAN_PROVIDER);
add(!uploadsOn
  ? { group: "Media", label: "Upload / scanner pairing", state: "pass", level: "blocker", envScoped: true,
      detail: "UGC media uploads disabled — nothing can be published unscanned" }
  : scannerConfigured
    ? { group: "Media", label: "Upload / scanner pairing", state: "pass", level: "blocker", envScoped: true,
        detail: "uploads enabled and a scan provider is configured" }
    : { group: "Media", label: "Upload / scanner pairing", state: "fail", level: "blocker", envScoped: true,
        detail: "UGC_MEDIA_UPLOADS_ENABLED=true with no scan provider configured",
        remedy: "This publishes files nothing scanned. Either configure the scanner or set UGC_MEDIA_UPLOADS_ENABLED=false. Never open the gate to make an upload work." });

// ── 8. Operations ──────────────────────────────────────────────────────────
add(set(env.ERROR_REPORT_URL)
  ? { group: "Operations", label: "Error reporting", state: "pass", level: "warn", envScoped: true, detail: "ERROR_REPORT_URL set" }
  : { group: "Operations", label: "Error reporting", state: "fail", level: "warn", envScoped: true,
      detail: "ERROR_REPORT_URL unset — errors go to the console and nowhere else",
      remedy: "A store release with no crash signal means the first you hear of a broken build is a one-star review." });

const emailReady =
  (env.EMAIL_PROVIDER === "resend" && set(env.RESEND_API_KEY) && set(env.EMAIL_FROM)) ||
  (env.EMAIL_PROVIDER === "smtp" && set(env.SMTP_HOST) && set(env.SMTP_USER) && set(env.SMTP_PASS) && set(env.EMAIL_FROM));
const sandboxSender = env.EMAIL_PROVIDER === "resend" && /@resend\.dev$/i.test(env.EMAIL_FROM ?? "");
add(!emailReady
  ? { group: "Operations", label: "Transactional email", state: "fail", level: "blocker", envScoped: true,
      detail: "no provider fully configured",
      remedy: "Password reset answers 503 by design rather than mint a token nobody receives. A store user who cannot reset a password leaves a one-star review." }
  : sandboxSender
    ? { group: "Operations", label: "Transactional email", state: "fail", level: "blocker", envScoped: true,
        detail: `EMAIL_FROM is ${env.EMAIL_FROM} — Resend's SANDBOX sender`,
        remedy: "It delivers only to the Resend account owner, and the reset route answers identically either way — so it looks exactly like working password reset while locking out every real user." }
    : { group: "Operations", label: "Transactional email", state: "pass", level: "blocker", envScoped: true,
        detail: `${env.EMAIL_PROVIDER} via ${env.EMAIL_FROM}` });

const evidenceReady = set(env.EVIDENCE_R2_BUCKET) && set(env.EVIDENCE_R2_ENDPOINT) &&
  set(env.EVIDENCE_R2_ACCESS_KEY_ID) && set(env.EVIDENCE_R2_SECRET_ACCESS_KEY);
add(evidenceReady
  ? { group: "Operations", label: "Private evidence storage", state: "pass", level: "blocker", envScoped: true, detail: "configured" }
  : { group: "Operations", label: "Private evidence storage", state: "fail", level: "blocker", envScoped: true,
      detail: "EVIDENCE_R2_* incomplete",
      remedy: "The startup guard REFUSES TO BOOT without these, so the service never listens and the health check times out. Four values, to a bucket that is NOT R2_BUCKET." });

// ── 9. The repository itself ───────────────────────────────────────────────
// A committed keystore or .env is unrecoverable in a way no later commit fixes:
// git history keeps it. Checked against what git actually TRACKS, not the
// working tree, because that is what a clone gets.
try {
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" });
  const leaked = tracked
    .split("\n")
    .filter((p) => /\.(keystore|jks|p12|pem|key)$/i.test(p) || /(^|\/)\.env(\.|$)/.test(p))
    .filter((p) => !p.endsWith(".env.example"));
  add(leaked.length === 0
    ? { group: "Repository", label: "No secrets committed", state: "pass", level: "blocker",
        detail: "no keystore, key or .env is tracked by git" }
    : { group: "Repository", label: "No secrets committed", state: "fail", level: "blocker",
        detail: leaked.join(", "),
        remedy: "Remove from history, not just from HEAD — a clone still has it. Then rotate whatever it contained." });
} catch {
  add({ group: "Repository", label: "No secrets committed", state: "skip", level: "info",
    detail: "git not available here" });
}

// ── Render ─────────────────────────────────────────────────────────────────
const failed = checks.filter((c) => c.state === "fail");
const blockers = failed.filter((c) => c.level === "blocker");

if (asJson) {
  process.stdout.write(JSON.stringify({ checks, blockers: blockers.length, failed: failed.length }, null, 2) + "\n");
  process.exit(blockers.length === 0 ? 0 : 1);
}

const ICON: Record<State, string> = { pass: "OK  ", fail: "FAIL", skip: "--  " };
process.stdout.write(`\nRELEASE DOCTOR — Google Play preflight\n${"═".repeat(78)}\n`);
process.stdout.write(`NODE_ENV    ${env.NODE_ENV ?? "(unset)"}\n`);
process.stdout.write(`site url    ${set(siteUrl) ? siteUrl : "(unset)"}\n`);

let group = "";
for (const c of checks) {
  if (c.group !== group) {
    group = c.group;
    process.stdout.write(`\n${group}\n${"─".repeat(78)}\n`);
  }
  const tag = c.state === "fail" ? (c.level === "blocker" ? " [BLOCKER]" : " [warn]") : "";
  process.stdout.write(`  ${ICON[c.state]}  ${c.label.padEnd(28)} ${c.detail}${c.envScoped ? "  [env]" : ""}${tag}\n`);
  if (c.state !== "pass" && c.remedy) process.stdout.write(`        └─ ${c.remedy}\n`);
}

process.stdout.write(`\n${"═".repeat(78)}\n`);
if (blockers.length === 0) {
  process.stdout.write(
    failed.length === 0
      ? "No blockers, no warnings.\n"
      : `No blockers. ${failed.length} warning(s) above.\n`,
  );
} else {
  process.stdout.write(`${blockers.length} BLOCKER(S) — do not submit until these are green:\n`);
  blockers.forEach((b, i) => process.stdout.write(`  ${String(i + 1).padStart(2)}. ${b.label} — ${b.detail}\n`));
}

process.stdout.write(
  `\n[env] marks a check that read THIS PROCESS'S environment, not production.\n` +
  `      Run it in the Render Shell for an answer about the live deployment.\n` +
  `      This command deliberately touches NO database — run \`npm run doctor:production\`\n` +
  `      for the platform-side checks (data, crons, providers).\n` +
  `      Live-origin checks (assetlinks, headers) are \`npm run android:verify\`.\n`,
);

process.exit(blockers.length === 0 ? 0 : 1);
