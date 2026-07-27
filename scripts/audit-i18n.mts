/**
 * i18n coverage audit.
 *
 * The app advertises 9 languages in the switcher. This measures how much of the
 * interface actually changes when you pick one, by counting user-visible strings
 * that are NOT routed through the translator.
 *
 * Deliberately a script and not a one-off analysis: the number only means something
 * if it can be re-run to show the gap closing. Run with:
 *
 *   npm run audit:i18n
 *
 * ── WHAT COUNTS AS USER-VISIBLE ───────────────────────────────────────────
 * A heuristic, and it says so. It looks for JSX text nodes and the string props that
 * reach a screen (title, label, placeholder, aria-label, description). It cannot know
 * whether a given string is really shown, so the absolute number is an upper bound —
 * but the RANKING by area is reliable, and that is what a migration needs.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(process.cwd(), "src");

/** Files that legitimately hold English-only strings. */
const SKIP = [
  `${sep}__tests__${sep}`,
  `lib${sep}i18n`,
  `lib${sep}config.ts`,
  // Server-only data, log lines and provider plumbing are never rendered.
  `lib${sep}scraper${sep}`,
  `services${sep}`,
  `lib${sep}data${sep}`,
  `.test.`,
  `.d.ts`,
];

/** String props whose value reaches a screen. */
const VISIBLE_PROPS = ["title", "label", "placeholder", "aria-label", "description", "alt", "eyebrow", "body", "cta"];

interface Hit { file: string; text: string }

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** Is this string worth translating? Filters out code-ish noise. */
function translatable(s: string): boolean {
  const t = s.trim();
  if (t.length < 3) return false;
  // Must contain at least two letters in a row and a space OR be a real word.
  if (!/[A-Za-z]{2}/.test(t)) return false;
  // Tailwind classes, URLs, identifiers, template fragments, single tokens in caps.
  if (/^[a-z-]+(\s[a-z-]+)*$/.test(t) && /(^|\s)(flex|grid|text|bg|border|rounded|px|py|mt|mb|gap|size|w-|h-)/.test(t)) return false;
  if (/^https?:\/\//.test(t)) return false;
  if (/^[a-z]+([A-Z][a-z]+)+$/.test(t)) return false; // camelCase identifier
  if (/^[A-Z_]+$/.test(t)) return false;              // CONST_CASE
  if (/^[\d\s.,:%+-]+$/.test(t)) return false;        // numbers/punctuation
  if (/^\W+$/.test(t)) return false;
  return true;
}

/** Area a file belongs to, for the ranking. */
function areaOf(rel: string): string {
  const parts = rel.split(sep);
  if (parts[0] === "app") {
    // app/events/[slug]/page.tsx -> app/events
    return parts.slice(0, 2).join("/");
  }
  if (parts[0] === "components") return `components/${parts[1] ?? ""}`;
  return parts[0];
}

const files = walk(ROOT).filter((f) => !SKIP.some((s) => f.includes(s)));

const hits: Hit[] = [];
let translated = 0;

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const rel = relative(ROOT, file);

  // Count existing usage, so the report shows progress rather than only debt.
  translated += (src.match(/\bt\(\s*["'`]/g) ?? []).length;

  // JSX text nodes: >Some words<
  for (const m of src.matchAll(/>\s*([A-Z][^<>{}\n]{2,120}?)\s*</g)) {
    const text = m[1].trim();
    if (translatable(text)) hits.push({ file: rel, text });
  }

  // Visible string props.
  for (const prop of VISIBLE_PROPS) {
    const re = new RegExp(`\\b${prop}=\\{?["']([^"']{3,120})["']`, "g");
    for (const m of src.matchAll(re)) {
      if (translatable(m[1])) hits.push({ file: rel, text: m[1] });
    }
  }
}

// ── report ────────────────────────────────────────────────────────────────
const byArea = new Map<string, Hit[]>();
for (const h of hits) {
  const a = areaOf(h.file);
  byArea.set(a, [...(byArea.get(a) ?? []), h]);
}

const ranked = [...byArea.entries()].sort((a, b) => b[1].length - a[1].length);
const unique = new Set(hits.map((h) => h.text)).size;

console.log("\n══ i18n COVERAGE AUDIT ══════════════════════════════════════\n");
console.log(`files scanned              ${files.length}`);
console.log(`t() call sites             ${translated}`);
console.log(`untranslated strings       ${hits.length}  (${unique} unique)`);
console.log(`estimated coverage         ${((translated / (translated + unique)) * 100).toFixed(1)}%`);
console.log("\n── worst areas ───────────────────────────────────────────────");
for (const [area, list] of ranked.slice(0, 18)) {
  console.log(`${String(list.length).padStart(4)}  ${area}`);
}

console.log("\n── a sample from the top area ───────────────────────────────");
for (const h of (ranked[0]?.[1] ?? []).slice(0, 12)) {
  console.log(`  ${h.file}: "${h.text.slice(0, 70)}"`);
}

// ── per-area coverage, and the CI guard ───────────────────────────────────
//
// A raw debt count cannot tell you whether an AREA is finished, and "finished" is
// what a launch decision needs: shipping Spanish means specific surfaces are
// complete, not that the total dropped a bit. So coverage is reported per area, and
// the areas at 100% are listed separately — those are the only ones safe to claim.
const tByArea = new Map<string, number>();
for (const file of files) {
  const rel = relative(ROOT, file);
  const n = (readFileSync(file, "utf8").match(/\bt\(\s*["'`]/g) ?? []).length;
  if (n) tByArea.set(areaOf(rel), (tByArea.get(areaOf(rel)) ?? 0) + n);
}

const areas = new Set<string>([...byArea.keys(), ...tByArea.keys()]);
const coverage = [...areas]
  .map((a) => {
    const missing = byArea.get(a)?.length ?? 0;
    const done = tByArea.get(a) ?? 0;
    const total = done + missing;
    return { area: a, done, missing, pct: total === 0 ? 100 : (done / total) * 100 };
  })
  .sort((x, y) => y.pct - x.pct);

console.log("\n── coverage by area ─────────────────────────────────────────");
for (const c of coverage) {
  const bar = "#".repeat(Math.round(c.pct / 10)).padEnd(10, ".");
  console.log(`  ${bar} ${c.pct.toFixed(0).padStart(3)}%  ${c.area}  (${c.done} done / ${c.missing} left)`);
}

const complete = coverage.filter((c) => c.pct === 100).map((c) => c.area);
console.log(`\nAREAS AT 100%: ${complete.length ? complete.join(", ") : "none"}`);

// ── CI mode ───────────────────────────────────────────────────────────────
// `--max=N` fails when the debt GROWS. A ratchet rather than a target: it cannot be
// satisfied by deleting the audit, and it lets a long migration land incrementally
// instead of needing a flag day.
const maxArg = process.argv.find((a) => a.startsWith("--max="));
if (maxArg) {
  const max = Number(maxArg.split("=")[1]);
  if (Number.isFinite(max) && unique > max) {
    console.error(
      `\nFAIL i18n debt grew: ${unique} unique untranslated strings > allowed ${max}.\n` +
        `  Wrap new user-facing text in t() (or tn() for counts), or raise --max deliberately.\n`,
    );
    process.exit(1);
  }
  console.log(`\nOK i18n debt within budget (${unique} <= ${max})`);
}
console.log("");
