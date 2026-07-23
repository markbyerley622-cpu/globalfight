// ════════════════════════════════════════════════════════════════════════
//  One-time text-normalization backfill + data-quality audit.
//
//  Fixes rows whose externally-sourced text was stored with the pre-fix decoder
//  (double-encoded HTML entities like `&#8217;`, `&amp;`, or invisible control
//  characters). Applies the SAME normalizer the ingestion path now uses
//  (src/lib/text/entities.ts), so a fixed row is byte-identical to how it would
//  be re-ingested — no drift.
//
//  Properties:
//    • DRY-RUN by default   — prints planned changes, writes nothing. Pass --apply.
//    • Idempotent           — only updates fields whose normalized value differs;
//                             a re-run touches nothing already-correct.
//    • Resumable            — processes id-ordered batches; interrupt & re-run is
//                             safe (already-fixed rows are skipped by the diff).
//    • Transactional        — each batch of row updates commits in one $transaction.
//    • Logged + progress     — per-model scanned/dirty/updated counts + samples.
//
//  Usage:
//    node --import tsx scripts/normalize-text-backfill.mts            # dry run, all models
//    node --import tsx scripts/normalize-text-backfill.mts --apply     # write changes
//    node --import tsx scripts/normalize-text-backfill.mts --model=article
//    node --import tsx scripts/normalize-text-backfill.mts --apply --batch=1000 --verbose
// ════════════════════════════════════════════════════════════════════════

import { PrismaClient } from "@prisma/client";
import { normalizeText, hasHtmlEntity } from "../src/lib/text/entities.ts";

const prisma = new PrismaClient();

// ── args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const VERBOSE = args.includes("--verbose");
const BATCH = Number(args.find((a) => a.startsWith("--batch="))?.split("=")[1] ?? "500");
const ONLY = args.find((a) => a.startsWith("--model="))?.split("=")[1]?.split(",").map((s) => s.trim().toLowerCase());

// Models + text fields that carry externally-sourced content and are normalized
// on the way in. These are the ones the backfill WRITES to.
const TARGETS: { model: "article" | "feedVideo"; label: string; fields: string[] }[] = [
  { model: "article", label: "Article", fields: ["title", "excerpt", "content"] },
  { model: "feedVideo", label: "FeedVideo", fields: ["title", "channel", "description"] },
];

// Additional models scanned READ-ONLY for the same class of corruption and
// reported (not auto-fixed — names are relationship-bearing and need review).
const AUDIT_ONLY: { model: string; fields: string[] }[] = [
  { model: "fighter", fields: ["name", "nickname"] },
  { model: "event", fields: ["name"] },
  { model: "gym", fields: ["name"] },
  { model: "forumThread", fields: ["title"] },
];

type Row = Record<string, unknown> & { id: string };

function needsFix(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  return normalizeText(value) !== value;
}

async function backfillModel(t: (typeof TARGETS)[number]) {
  const delegate = prisma[t.model] as unknown as {
    count: (a?: unknown) => Promise<number>;
    findMany: (a: unknown) => Promise<Row[]>;
    update: (a: unknown) => Promise<unknown>;
  };
  const total = await delegate.count();
  let scanned = 0, dirtyRows = 0, updatedRows = 0, cursor: string | undefined;
  const samples: string[] = [];

  for (;;) {
    const rows = await delegate.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      orderBy: { id: "asc" },
      take: BATCH,
      select: Object.fromEntries([["id", true], ...t.fields.map((f) => [f, true])]),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    scanned += rows.length;

    const updates: { id: string; data: Record<string, string> }[] = [];
    for (const row of rows) {
      const data: Record<string, string> = {};
      for (const f of t.fields) {
        if (needsFix(row[f])) data[f] = normalizeText(row[f] as string);
      }
      if (Object.keys(data).length > 0) {
        dirtyRows++;
        updates.push({ id: row.id, data });
        if (samples.length < 8) {
          const f = Object.keys(data)[0];
          samples.push(`  ${row.id}: ${JSON.stringify(String(row[f]).slice(0, 70))} -> ${JSON.stringify(data[f].slice(0, 70))}`);
        }
      }
    }

    if (updates.length > 0 && APPLY) {
      await prisma.$transaction(updates.map((u) => delegate.update({ where: { id: u.id }, data: u.data })));
      updatedRows += updates.length;
    }
    if (VERBOSE) process.stdout.write(`\r  ${t.label}: scanned ${scanned}/${total}, dirty ${dirtyRows}…`);
  }

  console.log(`\n${t.label}: scanned ${scanned}, dirty ${dirtyRows}, ${APPLY ? `updated ${updatedRows}` : "would update " + dirtyRows + " (dry run)"}`);
  if (samples.length) { console.log("  sample changes:"); samples.forEach((s) => console.log(s)); }
  return { scanned, dirtyRows, updatedRows };
}

async function auditModel(a: (typeof AUDIT_ONLY)[number]) {
  const delegate = prisma[a.model as keyof PrismaClient] as unknown as {
    findMany: (x: unknown) => Promise<Row[]>;
  } | undefined;
  if (!delegate?.findMany) return;
  let flagged = 0;
  const samples: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const rows = await delegate.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      orderBy: { id: "asc" }, take: BATCH,
      select: Object.fromEntries([["id", true], ...a.fields.map((f) => [f, true])]),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    for (const row of rows) {
      for (const f of a.fields) {
        const v = row[f];
        if (typeof v === "string" && (hasHtmlEntity(v) || needsFix(v))) {
          flagged++;
          if (samples.length < 5) samples.push(`  ${a.model}.${f} ${row.id}: ${JSON.stringify(v.slice(0, 70))}`);
        }
      }
    }
  }
  console.log(`AUDIT ${a.model}: ${flagged} field(s) with entities/control chars${flagged ? "" : " — clean"}`);
  samples.forEach((s) => console.log(s));
}

async function main() {
  console.log(`\n=== text-normalization backfill (${APPLY ? "APPLY — WRITING" : "DRY RUN — no writes"}) ===\n`);
  const targets = ONLY ? TARGETS.filter((t) => ONLY.includes(t.model.toLowerCase())) : TARGETS;

  let totalDirty = 0, totalUpdated = 0;
  for (const t of targets) {
    const r = await backfillModel(t);
    totalDirty += r.dirtyRows; totalUpdated += r.updatedRows;
  }

  console.log("\n--- data-quality audit (read-only) ---");
  for (const a of AUDIT_ONLY) await auditModel(a);

  console.log(`\n=== ${APPLY ? `DONE — updated ${totalUpdated} row(s)` : `DRY RUN — ${totalDirty} row(s) would change. Re-run with --apply to write.`} ===\n`);
}

main()
  .catch((e) => { console.error("backfill failed:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
