// ════════════════════════════════════════════════════════════════════════════
//  ANDROID VERIFY — the checks that need the LIVE production origin.
//
//    npm run android:verify                       # uses NEXT_PUBLIC_SITE_URL
//    npm run android:verify -- https://host.tld   # or an explicit origin
//
//  ── Why this is separate from `release:doctor` ───────────────────────────
//  `release:doctor` reads configuration. This makes real HTTPS requests to the
//  deployed site, so it is the only thing that can prove the statement Android
//  will actually fetch says what you think it says. Configuration being right
//  and the deployment serving it are different facts, and the gap between them
//  is where the "why does my TWA have a URL bar?" hours go.
//
//  ── The failure this exists to prevent ───────────────────────────────────
//  Digital Asset Links fail SILENTLY. A wrong fingerprint, a missing Play App
//  Signing key, a redirect, a 404 behind a CDN — none of them error. The app
//  installs, opens, and renders the site inside a Chrome tab with a URL bar.
//  Worse, Android CACHES the failure, so fixing it later does not immediately
//  fix the app. The only cheap moment to catch it is before the upload.
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Result { ok: boolean; label: string; detail: string; remedy?: string }
const results: Result[] = [];
const pass = (label: string, detail: string) => results.push({ ok: true, label, detail });
const fail = (label: string, detail: string, remedy?: string) => results.push({ ok: false, label, detail, remedy });

// ── Resolve the origin ─────────────────────────────────────────────────────
const argOrigin = process.argv.slice(2).find((a) => !a.startsWith("-"));
const raw = (argOrigin ?? process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
if (!raw) {
  console.error(
    "\n✖ No origin to verify.\n\n" +
      "  Pass one, or set NEXT_PUBLIC_SITE_URL:\n\n" +
      "    npm run android:verify -- https://yourdomain.com\n",
  );
  process.exit(1);
}
let origin: URL;
try {
  origin = new URL(raw);
} catch {
  console.error(`\n✖ Not a URL: ${raw}\n`);
  process.exit(1);
}
if (origin.protocol !== "https:") {
  console.error(`\n✖ ${origin.origin} is not https. A TWA cannot verify over http.\n`);
  process.exit(1);
}

const TIMEOUT_MS = 20_000;

// ── Cold starts are real on this deployment ────────────────────────────────
// Measured 2026-08-10: the first request to the Render host answered 502 on
// EVERY route for ~30 seconds, then the service came up reporting 49 seconds of
// uptime. A verifier that reported "assetlinks.json: 502 — do not upload" on a
// spin-up would be crying wolf, and the first thing anyone would do is stop
// believing it. So a 502/503/504 is retried with a widening gap; anything still
// failing after that is a real failure and is reported as one.
//
// This is ONLY forgiving about the gateway. A 404 is answered immediately —
// a missing route is not a warm-up problem.
const COLD_START_STATUSES = new Set([502, 503, 504]);
const RETRY_DELAYS_MS = [3_000, 6_000, 10_000, 15_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(path: string): Promise<{ status: number; body: string; headers: Headers; url: string } | null> {
  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(`${origin.origin}${path}`, {
        // `manual` would hide the destination. Following redirects and then
        // COMPARING the final URL is what catches the apex/www mismatch that
        // silently breaks asset links.
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": "globalfight-android-verify", "cache-control": "no-cache" },
      });
      if (COLD_START_STATUSES.has(res.status) && attempt < RETRY_DELAYS_MS.length) {
        process.stderr.write(`  … ${path} answered ${res.status}; waiting for the service (attempt ${attempt + 1})\n`);
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      return { status: res.status, body: await res.text(), headers: res.headers, url: res.url };
    } catch (e) {
      lastError = (e as Error).message;
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
    }
  }
  fail(path, `request failed after ${RETRY_DELAYS_MS.length + 1} attempts: ${lastError || "gateway never became healthy"}`,
    "The origin did not serve this route. If it answered 502/503 throughout, the deployment is not up — check Render's service events for a restart loop before blaming the route.");
  return null;
}

// ── 1. assetlinks.json ─────────────────────────────────────────────────────
const expectedPkg = (process.env.TWA_PACKAGE_NAME ?? "").trim();
const assetlinks = await get("/.well-known/assetlinks.json");

if (assetlinks) {
  if (assetlinks.status === 404) {
    fail("assetlinks.json", "404 — Digital Asset Links are not configured",
      "Set TWA_PACKAGE_NAME and TWA_SHA256_FINGERPRINTS on the DEPLOYMENT (not just locally). The 404 is deliberate: a malformed statement is worse, because Android caches the failure.");
  } else if (assetlinks.status !== 200) {
    fail("assetlinks.json", `HTTP ${assetlinks.status}`, "Android needs a 200 with a JSON array.");
  } else if (!new URL(assetlinks.url).pathname.endsWith("/.well-known/assetlinks.json")) {
    fail("assetlinks.json", `redirected to ${assetlinks.url}`,
      "Android fetches this on the app's own origin and does not chase a redirect to another host. Serve it directly.");
  } else {
    try {
      const statements = JSON.parse(assetlinks.body) as {
        relation?: string[];
        target?: { namespace?: string; package_name?: string; sha256_cert_fingerprints?: string[] };
      }[];

      if (!Array.isArray(statements) || statements.length === 0) {
        fail("assetlinks.json", "not a non-empty JSON array", "Android expects an array of statements.");
      } else {
        const android = statements.filter((s) => s.target?.namespace === "android_app");
        if (android.length === 0) {
          fail("assetlinks.json", "no android_app statement");
        } else {
          for (const s of android) {
            const p = s.target?.package_name ?? "(none)";
            const fps = s.target?.sha256_cert_fingerprints ?? [];
            const rel = s.relation ?? [];

            if (!rel.includes("delegate_permission/common.handle_all_urls")) {
              fail("assetlinks relation", `${p}: ${rel.join(", ") || "(none)"}`,
                "Must include delegate_permission/common.handle_all_urls, or Android will not hide the URL bar.");
            } else {
              pass("assetlinks relation", "delegate_permission/common.handle_all_urls");
            }

            if (expectedPkg && p !== expectedPkg) {
              fail("assetlinks package", `served ${p}, expected ${expectedPkg}`,
                "The live statement vouches for a DIFFERENT app than the one you are about to build.");
            } else {
              pass("assetlinks package", p);
            }

            const FP = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;
            const bad = fps.filter((f) => !FP.test(f.toUpperCase()));
            if (fps.length === 0) {
              fail("assetlinks fingerprints", "none published");
            } else if (bad.length) {
              fail("assetlinks fingerprints", `${bad.length} malformed`,
                "A SHA-256 fingerprint is 32 colon-separated hex octets. A 20-octet value is the SHA-1 line from the same keytool output.");
            } else if (fps.length < 2) {
              fail("assetlinks fingerprints", "only 1 published",
                "You almost always need two — the upload key AND the Play App Signing key. With one, either your internal-testing build or your production build shows a URL bar, and which one depends on which key you published.");
            } else {
              pass("assetlinks fingerprints", `${fps.length} published, all well-formed`);
            }
          }
        }
      }
    } catch (e) {
      fail("assetlinks.json", `not valid JSON: ${(e as Error).message}`,
        "A malformed file is worse than a missing one — Android caches the failure.");
    }
  }
}

// ── 1b. GOOGLE'S OWN VERIFIER — the authoritative answer ───────────────────
// Everything above parses the file ourselves. This asks the service ANDROID
// ACTUALLY CONSULTS whether the association verifies, which is a different and
// strictly better question: it resolves the host the way Android does (note it
// appends the root dot), follows its own fetch rules, and applies checks we
// cannot reproduce here.
//
// It is also the only way to find out that a host is unusable for reasons that
// have nothing to do with the file — and it is how this project established
// that the Render hostname is fine: on 2026-08-10 the ONLY error returned for
// globalfight-p69k.onrender.com was the 404 for the missing file. No objection
// to the domain, despite onrender.com being on the Public Suffix List. A custom
// domain is therefore NOT a technical prerequisite for the TWA.
const RELATION = "delegate_permission/common.handle_all_urls";
try {
  const api =
    `https://digitalassetlinks.googleapis.com/v1/statements:list` +
    `?source.web.site=${encodeURIComponent(origin.origin)}` +
    `&relation=${encodeURIComponent(RELATION)}`;
  const res = await fetch(api, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = (await res.json()) as {
    statements?: { target?: { androidApp?: { packageName?: string } } }[];
    errorCode?: string[];
    debugString?: string;
  };

  const errors = body.errorCode ?? [];
  const statements = body.statements ?? [];

  if (errors.length === 0 && statements.length > 0) {
    const apps = statements
      .map((s) => s.target?.androidApp?.packageName)
      .filter((p): p is string => Boolean(p));
    const matches = !expectedPkg || apps.includes(expectedPkg);
    if (matches) {
      pass("Google DAL verifier", `verified for ${apps.join(", ") || "(web target)"}`);
    } else {
      fail("Google DAL verifier", `verified, but for ${apps.join(", ")} — not ${expectedPkg}`,
        "Google can see a valid association with a DIFFERENT app. Android will not hide the URL bar for yours.");
    }
  } else {
    // The debugString is long and multi-line; the first Error line is the part
    // that says what is actually wrong.
    const firstError = (body.debugString ?? "").split("\n").find((l) => l.includes("Error:"))?.trim();
    fail("Google DAL verifier", `${errors.join(", ") || "no statements"}${firstError ? ` — ${firstError.slice(0, 220)}` : ""}`,
      "This is the service Android consults. Until it verifies, the app opens in a Chrome tab WITH A URL BAR. A 404 here simply means the deployment has no TWA_PACKAGE_NAME / TWA_SHA256_FINGERPRINTS set yet.");
  }
} catch (e) {
  fail("Google DAL verifier", `could not reach digitalassetlinks.googleapis.com: ${(e as Error).message}`,
    "Network-only failure — it says nothing about your configuration. Re-run when you have connectivity.");
}

// ── 2. The web manifest Bubblewrap reads ───────────────────────────────────
const manifest = await get("/manifest.webmanifest");
if (manifest) {
  if (manifest.status !== 200) {
    fail("manifest.webmanifest", `HTTP ${manifest.status}`, "Bubblewrap reads this at init time.");
  } else {
    try {
      const m = JSON.parse(manifest.body) as Record<string, unknown>;
      const icons = (m.icons ?? []) as { sizes?: string; purpose?: string }[];
      const hasMaskable = icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512");
      const problems: string[] = [];
      if (m.display !== "standalone") problems.push(`display=${String(m.display)} (want standalone)`);
      if (!m.name) problems.push("no name");
      if (!hasMaskable) problems.push("no 512x512 maskable icon");
      if (!m.start_url) problems.push("no start_url");

      if (problems.length) {
        fail("manifest.webmanifest", problems.join("; "),
          "Android crops a maskable icon to a circle; without one, an edge-to-edge logo loses its sides.");
      } else {
        pass("manifest.webmanifest", `${String(m.name)} · ${String(m.display)} · start_url ${String(m.start_url)}`);
      }
    } catch (e) {
      fail("manifest.webmanifest", `not valid JSON: ${(e as Error).message}`);
    }
  }
}

// ── 3. Transport + indexability ────────────────────────────────────────────
const root = await get("/");
if (root) {
  const hsts = root.headers.get("strict-transport-security");
  if (hsts) pass("HSTS", hsts);
  else fail("HSTS", "no Strict-Transport-Security header");

  if (new URL(root.url).protocol === "https:") pass("HTTPS", new URL(root.url).origin);
  else fail("HTTPS", `landed on ${root.url}`);
}

const robots = await get("/robots.txt");
if (robots && robots.status === 200) {
  // `Disallow: /` is what the app serves when NEXT_PUBLIC_SITE_URL is unset. It
  // does not block the TWA, but it means the production site is unindexed — and
  // it is the single clearest signal that the deployment does not know its own
  // origin, which is the same variable assetlinks depends on.
  if (/^\s*Disallow:\s*\/\s*$/m.test(robots.body)) {
    fail("robots.txt", "serving `Disallow: /`",
      "The deployment does not have NEXT_PUBLIC_SITE_URL set. The site is entirely unindexed, and the same unset variable is why other origin-derived things will be wrong.");
  } else {
    pass("robots.txt", "not blanket-disallowed");
  }
}

// ── 4. The two pages Play's forms point at ─────────────────────────────────
for (const [path, why] of [
  ["/privacy", "Play requires a privacy policy URL that resolves"],
  ["/delete-account", "Play requires a web-accessible account deletion route"],
] as const) {
  const res = await get(path);
  if (!res) continue;
  if (res.status !== 200) {
    fail(path, `HTTP ${res.status}`, why);
  } else if (/NOT CONFIGURED|must not be relied upon/i.test(res.body)) {
    fail(path, "renders the unconfigured-legal-identity placeholder",
      "The 7 LEGAL_* variables are unset on the deployment, so this page tells readers it must not be relied upon. Play will not accept it.");
  } else {
    pass(path, `200 · ${why}`);
  }
}

// ── 5. Local artefact agreement ────────────────────────────────────────────
const twaPath = join(ROOT, "android", "twa-manifest.json");
if (existsSync(twaPath)) {
  try {
    const m = JSON.parse(readFileSync(twaPath, "utf8")) as Record<string, string>;
    if (m.host !== origin.host) {
      fail("twa-manifest.json", `built for ${m.host}, verifying ${origin.host}`,
        "Regenerate with `npm run android:manifest` against the production origin.");
    } else {
      pass("twa-manifest.json", `${m.packageId} @ ${m.host} v${m.appVersionName} (code ${m.appVersionCode})`);
    }
  } catch { /* release:doctor reports the parse failure */ }
}

// ── Render ─────────────────────────────────────────────────────────────────
process.stdout.write(`\nANDROID VERIFY — ${origin.origin}\n${"═".repeat(78)}\n`);
for (const r of results) {
  process.stdout.write(`  ${r.ok ? "OK  " : "FAIL"}  ${r.label.padEnd(26)} ${r.detail}\n`);
  if (!r.ok && r.remedy) process.stdout.write(`        └─ ${r.remedy}\n`);
}

const failures = results.filter((r) => !r.ok);
process.stdout.write(`\n${"═".repeat(78)}\n`);
process.stdout.write(
  failures.length === 0
    ? `All ${results.length} live checks passed against ${origin.origin}.\n`
    : `${failures.length} FAILURE(S) against ${origin.origin} — do not upload.\n`,
);
process.stdout.write(
  `\nNote: this proves what the SITE serves. It cannot prove your keystore's\n` +
  `fingerprint matches what is published here — compare it yourself with\n` +
  `  keytool -list -v -keystore android/android.keystore -alias android\n` +
  `and Play Console → Setup → App integrity.\n`,
);

process.exit(failures.length === 0 ? 0 : 1);
