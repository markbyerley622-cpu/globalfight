// Generates ORIGINAL brand-coloured SVG marks for each promotion into
// public/promotions/<slug>.svg. These are our own designed badges (rounded tile,
// brand colour, white monogram) — NOT reproductions of any promotion's
// trademarked logo. Drop an official licensed logo at the same path to override.
//
//   node scripts/gen-promotion-logos.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "promotions");
mkdirSync(outDir, { recursive: true });

// slug, monogram, brand colour — mirrors src/lib/promotions.ts
const PROMOS = [
  ["ufc", "UFC", "#d20a0a"],
  ["one", "ONE", "#e8112d"],
  ["pfl", "PFL", "#e4002b"],
  ["bellator", "BEL", "#c8a24a"],
  ["bkfc", "BKFC", "#c8102e"],
  ["glory", "GLO", "#e2001a"],
  ["rizin", "RIZ", "#c9a227"],
  ["ksw", "KSW", "#d0021b"],
  ["oktagon", "OKT", "#00a3e0"],
  ["cage-warriors", "CW", "#d10a11"],
  ["lfa", "LFA", "#b11116"],
  ["eternal-mma", "ETL", "#1e88e5"],
  ["hex", "HEX", "#7b1fa2"],
  ["cffc", "CFFC", "#c0161d"],
  ["invicta", "INV", "#e91e63"],
  ["karate-combat", "KC", "#00b4d8"],
  ["adcc", "ADCC", "#2e7d32"],
  ["road-to-ufc", "RTU", "#d20a0a"],
  ["dwcs", "DWCS", "#d20a0a"],
];

const fontFor = (mark) => (mark.length <= 2 ? 42 : mark.length === 3 ? 34 : 25);

function svg(mark, brand) {
  const fs = fontFor(mark);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.18"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="2" y="2" width="96" height="96" rx="22" fill="${brand}"/>
  <rect x="2" y="2" width="96" height="96" rx="22" fill="url(#g)"/>
  <text x="50" y="50" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="800"
        letter-spacing="-1" font-size="${fs}" fill="#ffffff">${mark}</text>
</svg>
`;
}

for (const [slug, mark, brand] of PROMOS) {
  writeFileSync(join(outDir, `${slug}.svg`), svg(mark, brand), "utf8");
}
console.log(`Wrote ${PROMOS.length} marks to public/promotions/`);
