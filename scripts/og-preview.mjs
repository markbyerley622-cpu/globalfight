// Preview an Open Graph card through the REAL next/og pipeline.
//
// WHY THIS EXISTS: next/og cannot run on Windows in this Next version. Its
// bundled font loader does path.join() on a file:// URL, which mangles to
// ".\file:\C:\..." and throws ERR_INVALID_URL on every request. On POSIX the
// same join collapses to "file:/..." which fileURLToPath accepts, so Render is
// unaffected — but a Windows dev otherwise has NO way to see a share image.
//
// Run it in Linux:
//   docker run --rm -v "<repo>:/app" -w /app node:22-alpine node scripts/og-preview.mjs
//
// Writes og-preview.png (gitignored). Keep the layout here in step with
// src/lib/og.tsx — this is a preview harness, not a second implementation.
import { writeFileSync, readFileSync } from "node:fs";
import { createElement as h } from "react";
// Import the compiled module directly: the bare "next/og" specifier resolves
// through package exports, which the container's ESM loader does not apply to a
// bind-mounted tree. This is the same code path next/og uses.
import { ImageResponse } from "next/dist/compiled/@vercel/og/index.node.js";

const FONT = readFileSync("public/fonts/og-noto-sans-400.ttf");
const INK = "#0a0b0d", CHALK = "#f4f5f7", MIST = "#c7cad1", FOG = "#8b909a";
const accent = "#e8112d";

const chip = (t) => h("div", {
  key: t,
  style: { display: "flex", alignItems: "center", padding: "13px 26px", borderRadius: 999,
    background: "#16181d", border: "2px solid #262a32", color: MIST, fontSize: 27 },
}, t);

const el = h("div", {
  style: { width: "100%", height: "100%", display: "flex", flexDirection: "column",
    justifyContent: "space-between", background: INK, padding: 64, position: "relative" },
}, [
  h("div", { key: "wash", style: { position: "absolute", top: 0, left: 0, width: 1200, height: 630, display: "flex",
    background: `radial-gradient(75% 110% at 0% 0%, ${accent}5e, transparent 68%)` } }),
  h("div", { key: "bar", style: { position: "absolute", top: 0, left: 0, width: 14, height: 630, background: accent, display: "flex" } }),
  h("div", { key: "top", style: { display: "flex", alignItems: "center", justifyContent: "space-between" } }, [
    h("div", { key: "e", style: { display: "flex", fontSize: 25, letterSpacing: 5, color: accent, textTransform: "uppercase" } }, "ONE Championship"),
    h("div", { key: "b", style: { display: "flex", fontSize: 25, letterSpacing: 4, color: FOG, textTransform: "uppercase" } }, "Combat Reviews"),
  ]),
  h("div", { key: "mid", style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 44 } }, [
    h("div", { key: "l", style: { display: "flex", flexDirection: "column", maxWidth: 780 } }, [
      h("div", { key: "h", style: { display: "flex", fontSize: 80, lineHeight: 1.06, color: CHALK, letterSpacing: -2 } }, "Superbon vs Noiri"),
      h("div", { key: "s", style: { display: "flex", marginTop: 20, fontSize: 33, color: MIST } }, "ONE 173: Superbon vs. Noiri"),
    ]),
    h("div", { key: "badge", style: { display: "flex", alignItems: "center", justifyContent: "center",
      minWidth: 200, height: 200, borderRadius: 28, background: `${accent}26`, border: `4px solid ${accent}`,
      color: CHALK, fontSize: 68, padding: "0 26px", letterSpacing: -1 } }, "VS"),
  ]),
  h("div", { key: "chips", style: { display: "flex", gap: 14 } },
    ["Sun 16 Nov 2025", "16 bouts", "Tokyo, Japan", "Prime Video"].map(chip)),
]);

const res = new ImageResponse(el, {
  width: 1200, height: 630,
  fonts: [{ name: "NotoSans", data: FONT, weight: 400, style: "normal" }],
});
const buf = Buffer.from(await res.arrayBuffer());
writeFileSync("og-preview.png", buf);
const isPng = buf.slice(1, 4).toString() === "PNG";
console.log("platform:", process.platform);
console.log("bytes:", buf.length, "png:", isPng, "dims:", isPng ? `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}` : "n/a");
