// Post-upgrade sharp smoke: exercises exactly the operations src/lib/images/store.ts
// uses — resize(cover/inside), rotate (EXIF), webp, metadata, toBuffer — on a
// synthetic source image. Exits non-zero on any failure.
import sharp from "sharp";

const src = await sharp({
  create: { width: 900, height: 600, channels: 3, background: { r: 120, g: 20, b: 20 } },
}).jpeg().toBuffer();

// Avatar pipeline: cover-fit squares/16:9 → webp
const thumb = await sharp(src).resize(160, 160, { fit: "cover", position: "top" }).webp({ quality: 82 }).toBuffer();
const hero = await sharp(src).resize(1280, 720, { fit: "cover", position: "top" }).webp({ quality: 82 }).toBuffer();

// Content pipeline: rotate (EXIF) + inside-fit + metadata recovery
const meta = await sharp(src).metadata();
const full = await sharp(src).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
const fullMeta = await sharp(full).metadata();

const ok =
  thumb.length > 0 && hero.length > 0 && full.length > 0 &&
  meta.width === 900 && meta.height === 600 &&
  fullMeta.format === "webp";

console.log(`sharp ${(await import("sharp")).default.versions?.sharp ?? "?"} smoke:`,
  { thumb: thumb.length, hero: hero.length, full: full.length, srcMeta: `${meta.width}x${meta.height}`, fullFormat: fullMeta.format });

if (!ok) { console.error("SHARP SMOKE FAILED"); process.exit(1); }
console.log("SHARP SMOKE OK");
