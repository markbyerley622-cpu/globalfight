// ════════════════════════════════════════════════════════════════════════════
//  ANDROID DOCTOR — can THIS MACHINE build the AAB?
//
//    npm run android:doctor
//
//  The third and last of the doctors, and the only one about the toolchain:
//
//    release:doctor    is the RELEASE configured?      (needs nothing)
//    android:verify    does the LIVE SITE serve it?    (needs the deployment)
//    android:doctor    can this BOX build it?          (needs the toolchain)
//    doctor:production is the PLATFORM ready?          (needs the database)
//
//  Bubblewrap's first run is INTERACTIVE — it offers to download a JDK and the
//  Android SDK and blocks on a prompt. That is fine at a terminal and fatal in
//  CI or any non-TTY context, where it dies with a readline error that names
//  nothing useful. This reports the state instead of hanging, so "why did the
//  build do nothing?" has an answer before anyone runs the build.
// ════════════════════════════════════════════════════════════════════════════

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Row { ok: boolean; label: string; detail: string; remedy?: string }
const rows: Row[] = [];
const ok = (label: string, detail: string) => rows.push({ ok: true, label, detail });
const no = (label: string, detail: string, remedy?: string) => rows.push({ ok: false, label, detail, remedy });

/** Run a command and return its combined first line, or null if it is absent. */
function probe(cmd: string, args: string[]): string | null {
  try {
    const out = execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      shell: process.platform === "win32",
    });
    return out.split("\n").find((l) => l.trim())?.trim() ?? "";
  } catch (e) {
    // Java prints -version to STDERR and exits 0; some wrappers exit non-zero.
    // Salvage the output rather than calling a present tool missing.
    const err = e as { stderr?: Buffer | string; stdout?: Buffer | string; code?: string };
    if (err.code === "ENOENT") return null;
    const text = String(err.stderr ?? err.stdout ?? "");
    const line = text.split("\n").find((l) => l.trim())?.trim();
    // ── Do not mistake the SHELL's complaint for the TOOL's output ─────────
    // `shell: true` is needed on Windows to resolve .cmd shims, but it also
    // means a missing binary comes back as cmd.exe's own message on stderr with
    // a non-zero exit — which is indistinguishable from a tool that printed to
    // stderr and exited non-zero (which `java -version` legitimately does).
    // Without this, `android:doctor` reported "OK  System java  'java' is not
    // recognized as an internal or external command" — a green tick on the
    // exact string that means it is absent.
    if (!line || /is not recognized|command not found|No such file or directory/i.test(line)) return null;
    return line;
  }
}

// ── Bubblewrap ─────────────────────────────────────────────────────────────
const bwConfigPath = join(homedir(), ".bubblewrap", "config.json");
const bwInstalled = probe("bubblewrap", ["--help"]) !== null;
if (!bwInstalled) {
  no("Bubblewrap CLI", "not installed",
    "npm i -g @bubblewrap/cli   — and install a CURRENT version: the target SDK of the generated project comes from its template, and Play requires API 36 from 2026-08-31.");
} else {
  ok("Bubblewrap CLI", "installed");
}

// ── The JDK + Android SDK Bubblewrap will use ──────────────────────────────
// Bubblewrap records them here after its first (interactive) run. Reading the
// file is how we can tell "bootstrapped" from "will block on a prompt".
if (!existsSync(bwConfigPath)) {
  no("Bubblewrap bootstrap", "~/.bubblewrap/config.json missing",
    "The FIRST bubblewrap command is interactive — it asks whether to download the JDK and Android SDK. Run `bubblewrap doctor` AT A REAL TERMINAL once and answer the prompts. In a non-TTY it dies with `ERR_USE_AFTER_CLOSE: readline was closed`, which names nothing useful.");
} else {
  try {
    const cfg = JSON.parse(readFileSync(bwConfigPath, "utf8")) as { jdkPath?: string; androidSdkPath?: string };
    const jdkOk = Boolean(cfg.jdkPath && existsSync(cfg.jdkPath));
    const sdkOk = Boolean(cfg.androidSdkPath && existsSync(cfg.androidSdkPath));
    rows.push(jdkOk
      ? { ok: true, label: "JDK (Bubblewrap)", detail: cfg.jdkPath! }
      : { ok: false, label: "JDK (Bubblewrap)", detail: cfg.jdkPath ? `configured but missing: ${cfg.jdkPath}` : "not configured",
          remedy: "Bubblewrap needs JDK 17. Let it install one, or point it at your own." });
    rows.push(sdkOk
      ? { ok: true, label: "Android SDK", detail: cfg.androidSdkPath! }
      : { ok: false, label: "Android SDK", detail: cfg.androidSdkPath ? `configured but missing: ${cfg.androidSdkPath}` : "not configured",
          remedy: "Bubblewrap downloads the command-line tools on first run and accepts the SDK licences interactively." });
  } catch (e) {
    no("Bubblewrap bootstrap", `~/.bubblewrap/config.json unreadable: ${(e as Error).message}`);
  }
}

// ── Android SDK licences ───────────────────────────────────────────────────
// Discovered the hard way on 2026-08-10: with the SDK downloaded and the
// Bubblewrap config valid, `bubblewrap build` still logged
//   "Skipping following packages as the license is not accepted:
//    Android SDK Build-Tools 36.1"
// and carried on. Build-Tools 36.1 is exactly what a targetSdk-36 build needs,
// so the licence gate is a silent cause of a build that cannot meet Play's
// current requirement.
//
// Accepting the licence is a LEGAL ACT BY THE DEVELOPER and no script in this
// repository does it for you — this only reports whether you have.
try {
  const cfg = existsSync(bwConfigPath)
    ? (JSON.parse(readFileSync(bwConfigPath, "utf8")) as { androidSdkPath?: string })
    : {};
  if (cfg.androidSdkPath) {
    const licenceDir = join(cfg.androidSdkPath, "licenses");
    const accepted = existsSync(licenceDir);
    rows.push(accepted
      ? { ok: true, label: "SDK licences", detail: `accepted (${licenceDir})` }
      : { ok: false, label: "SDK licences", detail: "none accepted",
          remedy: "Build-Tools is SKIPPED without them and the build quietly produces nothing usable. Accept them yourself, at a terminal:\n           sdkmanager --licenses      (from the SDK's cmdline-tools/latest/bin)\n           The legacy tools/bin/sdkmanager shipped here does NOT support --licenses; install cmdline-tools via Android Studio or the standalone package. This is Google's licence to accept, not this repo's." });
  }
} catch { /* the config parse failure is already reported above */ }

// ── Is the SDK actually POPULATED? ─────────────────────────────────────────
// `androidSdkPath` existing proves only that a directory was created. After the
// licence refusal above, the whole SDK contained exactly one folder — `tools`,
// the deprecated package — with NO build-tools and NO platforms. Bubblewrap's
// own `doctor` still reported the path "valid", because it checks the path and
// not the contents. Checking for the packages a build consumes is the
// difference between "an SDK is configured" and "an SDK can build anything".
try {
  const cfg = existsSync(bwConfigPath)
    ? (JSON.parse(readFileSync(bwConfigPath, "utf8")) as { androidSdkPath?: string })
    : {};
  if (cfg.androidSdkPath && existsSync(cfg.androidSdkPath)) {
    for (const [dir, what] of [["build-tools", "Build-Tools"], ["platforms", "Platform SDK"]] as const) {
      const p = join(cfg.androidSdkPath, dir);
      const versions = existsSync(p) ? readdirSync(p) : [];
      rows.push(versions.length
        ? { ok: true, label: what, detail: versions.join(", ") }
        : { ok: false, label: what, detail: "not installed",
            remedy: `The SDK directory exists but contains no ${dir}. This is what an unaccepted licence looks like — the download is SKIPPED with a warning and the build fails later for an unrelated-looking reason.` });
    }
  }
} catch { /* reported above */ }

// ── The target SDK Bubblewrap will GENERATE ────────────────────────────────
// Play requires API 36 for new apps and updates from 2026-08-31. The generated
// project's targetSdk comes from the CLI's own template, so the only way to know
// what you are about to build is to read the template you have installed —
// checking `android/app/build.gradle` finds out AFTER generating, which is a
// whole build too late.
const REQUIRED_TARGET_SDK = 36;
try {
  const cliRoot = probe("npm", ["root", "-g"]);
  const template = cliRoot
    ? join(cliRoot, "@bubblewrap", "cli", "node_modules", "@bubblewrap", "core", "template_project", "app", "build.gradle")
    : null;
  if (template && existsSync(template)) {
    const gradle = readFileSync(template, "utf8");
    const target = Number(/targetSdkVersion\s+(\d+)/.exec(gradle)?.[1] ?? 0);
    const compile = Number(/compileSdkVersion\s+(\d+)/.exec(gradle)?.[1] ?? 0);
    rows.push(target >= REQUIRED_TARGET_SDK
      ? { ok: true, label: `Template targetSdk`, detail: `targetSdk ${target}, compileSdk ${compile}` }
      : { ok: false, label: `Template targetSdk`, detail: `targetSdk ${target} — Play requires ${REQUIRED_TARGET_SDK}`,
          remedy: `From 2026-08-31 Play rejects new apps and updates below API ${REQUIRED_TARGET_SDK}. The value comes from the Bubblewrap TEMPLATE, so the fix is to update the CLI — \`npm i -g @bubblewrap/cli\` — not to hand-patch the generated project, which the next \`bubblewrap update\` would overwrite.` });
  } else {
    rows.push({ ok: false, label: "Template targetSdk", detail: "Bubblewrap template not found",
      remedy: "Install the CLI globally: npm i -g @bubblewrap/cli" });
  }
} catch { /* non-fatal */ }

// A system JDK is not required (Bubblewrap can bring its own) but `keytool` is
// how you read the fingerprint that has to reach assetlinks.json, so its
// absence is worth naming.
const java = probe("java", ["-version"]);
rows.push(java
  ? { ok: true, label: "System java", detail: java }
  : { ok: false, label: "System java", detail: "not on PATH",
      remedy: "Optional for building (Bubblewrap uses its own JDK), but `keytool` lives beside it and is the only way to read your keystore's SHA-256. Use <jdkPath>/bin/keytool if you have no system JDK." });

// ── The artefacts ──────────────────────────────────────────────────────────
const twa = join(ROOT, "android", "twa-manifest.json");
if (existsSync(twa)) {
  try {
    const m = JSON.parse(readFileSync(twa, "utf8")) as Record<string, string>;
    ok("twa-manifest.json", `${m.packageId} @ ${m.host} v${m.appVersionName} (code ${m.appVersionCode})`);
  } catch {
    no("twa-manifest.json", "unparseable", "Regenerate with `npm run android:manifest`.");
  }
} else {
  no("twa-manifest.json", "not generated",
    "NEXT_PUBLIC_SITE_URL=… TWA_PACKAGE_NAME=… npm run android:manifest");
}

const keystore = join(ROOT, "android", "android.keystore");
rows.push(existsSync(keystore)
  ? { ok: true, label: "Upload keystore", detail: "android/android.keystore present (gitignored)" }
  : { ok: false, label: "Upload keystore", detail: "not present",
      remedy: "OPERATOR ACTION — generate it yourself. `bubblewrap init` offers to create one, or:\n           keytool -genkeypair -v -keystore android/android.keystore -alias android \\\n             -keyalg RSA -keysize 2048 -validity 10000\n           This key IS the app's identity. Play will not re-key a published listing: lose it and you can never update the app, leak it and anyone can sign as you. Back it up to a password manager AND offline before you build." });

const aab = join(ROOT, "android", "app-release-bundle.aab");
rows.push(existsSync(aab)
  ? { ok: true, label: "AAB", detail: "android/app-release-bundle.aab present" }
  : { ok: false, label: "AAB", detail: "not built", remedy: "cd android && bubblewrap build" });

// ── Render ─────────────────────────────────────────────────────────────────
process.stdout.write(`\nANDROID DOCTOR — build toolchain\n${"═".repeat(78)}\n`);
for (const r of rows) {
  process.stdout.write(`  ${r.ok ? "OK  " : "FAIL"}  ${r.label.padEnd(22)} ${r.detail}\n`);
  if (!r.ok && r.remedy) process.stdout.write(`        └─ ${r.remedy}\n`);
}

const missing = rows.filter((r) => !r.ok);
process.stdout.write(`\n${"═".repeat(78)}\n`);
process.stdout.write(
  missing.length === 0
    ? "Toolchain complete — `cd android && bubblewrap build` should produce the AAB.\n"
    : `${missing.length} item(s) outstanding before this machine can produce an AAB.\n`,
);
process.exit(missing.length === 0 ? 0 : 1);
