// ════════════════════════════════════════════════════════════════════════════
//  Generate android/twa-manifest.json for Bubblewrap.
//
//  ── Why this is generated and not committed ──────────────────────────────
//  Bubblewrap's manifest hard-codes the ORIGIN in six separate fields (host,
//  iconUrl, maskableIconUrl, webManifestUrl, fullScopeUrl, every shortcut icon).
//  Committing one bakes in a single answer to a question this repo has already
//  decided is environment-scoped: NEXT_PUBLIC_SITE_URL is unset by default and
//  the site deliberately serves `robots: Disallow: /` until it is set. A
//  committed manifest would be silently wrong in every environment but one —
//  and the way a wrong origin FAILS is the worst kind. The app builds,
//  installs, opens, and shows a Chrome URL bar. Nothing errors.
//
//  ── Why it IMPORTS src/app/manifest.ts ───────────────────────────────────
//  Name, colours, start_url, orientation and shortcuts exist in the web
//  manifest already. Re-typing them here would create a second source of truth
//  that drifts the first time someone changes a colour — and the drift is
//  invisible, because the two manifests are read by different things at
//  different times (Chrome reads the web one at install; Bubblewrap reads this
//  one at build). Reading the real module means there is nothing to keep in
//  step.
//
//  ── Why the version lives in android/version.json ────────────────────────
//  Play rejects an upload whose versionCode it has already seen, and a
//  timestamp- or commit-count-derived code is unreviewable: you cannot tell
//  from a diff what the next upload will claim to be. A committed integer means
//  every release is a commit that says so, and `npm run android:bump` is the
//  only thing that moves it.
//
//  NOTHING SECRET IS WRITTEN HERE. `signingKey.path` is a PATH; the keystore is
//  created by Bubblewrap outside the repo and is gitignored.
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// Namespace import + explicit `.default` unwrap: the app is compiled by Next,
// not by this script, and under tsx's CJS interop a `default` export can arrive
// as `{ default: fn }`. A bare default import resolved to the module object and
// threw "webManifest is not a function".
import * as webManifestModule from "../src/app/manifest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "android", "twa-manifest.json");

function die(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

// ── The origin ─────────────────────────────────────────────────────────────
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
if (!siteUrl) {
  die(
    "NEXT_PUBLIC_SITE_URL is unset.\n\n" +
      "  It is the origin the Android app opens, and there is no safe default:\n" +
      "  a wrong one produces an app that launches with a Chrome URL BAR and\n" +
      "  never reports an error. Set it to the FULL origin, scheme included:\n\n" +
      "    NEXT_PUBLIC_SITE_URL=https://yourdomain.com npm run android:manifest\n\n" +
      "  It must be the host that also serves /.well-known/assetlinks.json —\n" +
      "  Android compares the two.",
  );
}

let origin: URL;
try {
  origin = new URL(siteUrl);
} catch {
  die(`NEXT_PUBLIC_SITE_URL is not a URL: ${siteUrl}`);
}
if (origin.protocol !== "https:") {
  die(
    `NEXT_PUBLIC_SITE_URL must be https (got "${origin.protocol}").\n` +
      "  A Trusted Web Activity cannot verify over http, and Play blocks\n" +
      "  cleartext traffic by default.",
  );
}
const base = origin.origin;

// ── The package id ─────────────────────────────────────────────────────────
const packageId = (process.env.TWA_PACKAGE_NAME ?? "").trim();
if (!packageId) {
  die(
    "TWA_PACKAGE_NAME is unset.\n\n" +
      "  This is the Android application id. It is PERMANENT once published,\n" +
      "  and the same value must be set on the DEPLOYMENT so\n" +
      "  /.well-known/assetlinks.json vouches for the right app.\n\n" +
      "    TWA_PACKAGE_NAME=com.example.app npm run android:manifest",
  );
}
if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageId)) {
  die(
    `TWA_PACKAGE_NAME is not a valid Android application id: "${packageId}"\n` +
      "  Lower-case, two or more dot-separated segments, each starting with a\n" +
      "  letter. Play accepts nothing else, and it cannot be changed later.",
  );
}

// ── The version ────────────────────────────────────────────────────────────
interface Version { versionName: string; versionCode: number }
let version: Version;
try {
  version = JSON.parse(readFileSync(join(ROOT, "android", "version.json"), "utf8")) as Version;
} catch (e) {
  die(`Could not read android/version.json: ${(e as Error).message}`);
}
if (!Number.isInteger(version.versionCode) || version.versionCode < 1) {
  die("android/version.json: versionCode must be a positive integer.");
}
if (typeof version.versionName !== "string" || !version.versionName.trim()) {
  die("android/version.json: versionName must be a non-empty string.");
}

// ── Everything shared with the web manifest, read from the web manifest ────
type ManifestFn = () => import("next").MetadataRoute.Manifest;
const mod = webManifestModule as unknown as { default?: ManifestFn | { default?: ManifestFn } };
const webManifest =
  typeof mod.default === "function"
    ? mod.default
    : typeof (mod.default as { default?: ManifestFn })?.default === "function"
      ? (mod.default as { default: ManifestFn }).default
      : die("Could not load the default export of src/app/manifest.ts");

const web = webManifest();
const themeColor = web.theme_color ?? "#000000";
const backgroundColor = web.background_color ?? themeColor;
const name = web.name ?? "Combat Reviews";

const iconFor = (size: string, maskable: boolean) =>
  web.icons?.find((i) => i.sizes === size && (maskable ? i.purpose === "maskable" : i.purpose === "any"))?.src;

const icon512 = iconFor("512x512", false);
const maskable512 = iconFor("512x512", true);
const icon192 = iconFor("192x192", false);
if (!icon512 || !maskable512 || !icon192) {
  die(
    "src/app/manifest.ts no longer declares the icons this build needs\n" +
      "  (192 any, 512 any, 512 maskable). Bubblewrap generates every Android\n" +
      "  density from those; without the maskable one Android crops a square\n" +
      "  logo to a circle and clips its edges.",
  );
}

const manifest = {
  packageId,
  host: origin.host,
  name,
  launcherName: web.short_name ?? name,
  display: web.display ?? "standalone",
  themeColor,
  themeColorDark: themeColor,
  navigationColor: themeColor,
  navigationColorDark: themeColor,
  navigationDividerColor: themeColor,
  navigationDividerColorDark: themeColor,
  backgroundColor,
  startUrl: web.start_url ?? "/",
  iconUrl: `${base}${icon512}`,
  maskableIconUrl: `${base}${maskable512}`,
  // No monochromeIconUrl: public/icons has no monochrome asset, and naming one
  // that does not exist makes the Android 13+ themed-icon slot render BLANK
  // rather than fall back to the normal icon.
  appVersionName: version.versionName,
  appVersionCode: version.versionCode,
  shortcuts: (web.shortcuts ?? []).slice(0, 4).map((s) => ({
    name: s.name,
    short_name: s.short_name ?? s.name,
    url: s.url,
    chosenIconUrl: `${base}${icon192}`,
  })),
  webManifestUrl: `${base}/manifest.webmanifest`,
  fullScopeUrl: `${base}/`,
  // ── The failure mode this line controls ────────────────────────────────
  // "customtabs" means: if Digital Asset Links do NOT verify, fall back to a
  // Chrome Custom Tab (with a URL bar) rather than a bare WebView. That is the
  // right trade — a WebView fallback would lose the user's Chrome cookie jar,
  // so a signed-in tester would appear signed out with nothing to explain it.
  // A URL bar is ugly and diagnostic; a silently lost session is neither.
  fallbackType: "customtabs",
  // Web push, issued by the user's own Chrome exactly as on the web — no second
  // notification system and no FCM key in this repo. On Android 13+ this is
  // what makes the runtime POST_NOTIFICATIONS permission be requested.
  enableNotifications: true,
  orientation: web.orientation ?? "portrait",
  // Bubblewrap's floor for a TWA. Explicit so a future bump is a visible
  // decision rather than a silent dependency upgrade.
  minSdkVersion: 21,
  splashScreenFadeOutDuration: 300,
  enableSiteSettingsShortcut: true,
  isChromeOSOnly: false,
  isMetaQuest: false,
  // Written by `bubblewrap fingerprint add`, never by this script: the
  // fingerprint that matters in production belongs to Play App Signing, which
  // does not exist until the first upload.
  fingerprints: [] as unknown[],
  additionalTrustedOrigins: [] as string[],
  retainedBundles: [] as number[],
  alphaDependencies: { enabled: false },
  features: {},
  signingKey: {
    // Outside the repo on purpose (see .gitignore). A committed keystore is an
    // unrecoverable compromise of the app's identity — Play will not let you
    // re-key a published listing.
    path: "./android.keystore",
    alias: "android",
  },
  generatorApp: "globalfight/scripts/twa-manifest.mts",
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`✔ android/twa-manifest.json written
    origin        ${base}
    packageId     ${packageId}
    name          ${name}
    startUrl      ${manifest.startUrl}
    versionName   ${version.versionName}
    versionCode   ${version.versionCode}

  Build:
    cd android && bubblewrap build

  BEFORE submitting, set these on the DEPLOYMENT so
  /.well-known/assetlinks.json stops answering 404:
    TWA_PACKAGE_NAME=${packageId}
    TWA_SHA256_FINGERPRINTS=<upload key SHA-256>,<Play App Signing key SHA-256>
`);
