// Phase 3 — Lighthouse across the key routes. Launches headless Chrome via
// chrome-launcher, runs the four core categories, and writes a JSON summary +
// per-route HTML reports under test/lighthouse/reports.
//
// Usage: node test/lighthouse/run-lighthouse.mjs [baseUrl]
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? "http://localhost:3210";
const OUT = join(__dir, "reports");
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  ["landing", "/"],
  ["events", "/events"],
  ["fighters", "/fighters"],
  ["leaderboard", "/leaderboard"],
  ["predictions", "/predictions"],
  ["community", "/community"],
  ["home", "/home"],
];

const chrome = await launch({ chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"] });
const opts = {
  port: chrome.port,
  output: ["json", "html"],
  logLevel: "error",
  onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
  // Desktop preset — the app is mobile-first but we certify both; desktop is the
  // stricter perf baseline on a dev box. Mobile throttling on localhost is noise.
  formFactor: "desktop",
  screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
  throttlingMethod: "simulate",
};

const summary = [];
for (const [name, path] of ROUTES) {
  const url = BASE + path;
  process.stdout.write(`Lighthouse: ${name} (${url}) … `);
  try {
    const runnerResult = await lighthouse(url, opts);
    const { categories } = runnerResult.lhr;
    const scores = {
      performance: Math.round((categories.performance?.score ?? 0) * 100),
      accessibility: Math.round((categories.accessibility?.score ?? 0) * 100),
      bestPractices: Math.round((categories["best-practices"]?.score ?? 0) * 100),
      seo: Math.round((categories.seo?.score ?? 0) * 100),
    };
    const audits = runnerResult.lhr.audits;
    const vitals = {
      lcp: audits["largest-contentful-paint"]?.displayValue ?? "n/a",
      cls: audits["cumulative-layout-shift"]?.displayValue ?? "n/a",
      tbt: audits["total-blocking-time"]?.displayValue ?? "n/a",
      fcp: audits["first-contentful-paint"]?.displayValue ?? "n/a",
      si: audits["speed-index"]?.displayValue ?? "n/a",
    };
    summary.push({ name, path, scores, vitals });
    writeFileSync(join(OUT, `${name}.report.html`), runnerResult.report[1]);
    console.log(
      `P${scores.performance} A${scores.accessibility} BP${scores.bestPractices} SEO${scores.seo} | LCP ${vitals.lcp} CLS ${vitals.cls} TBT ${vitals.tbt}`,
    );
  } catch (e) {
    console.log("ERROR", e.message);
    summary.push({ name, path, error: e.message });
  }
}

writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
await chrome.kill();

// Console table for the report.
console.log("\n=== LIGHTHOUSE SUMMARY ===");
for (const r of summary) {
  if (r.error) { console.log(`${r.name}: ERROR ${r.error}`); continue; }
  console.log(
    `${r.name.padEnd(12)} Perf ${String(r.scores.performance).padStart(3)}  A11y ${String(r.scores.accessibility).padStart(3)}  BP ${String(r.scores.bestPractices).padStart(3)}  SEO ${String(r.scores.seo).padStart(3)}`,
  );
}
