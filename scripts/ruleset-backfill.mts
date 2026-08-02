// Fill Fight.ruleset for bouts written before the column existed.
//
//   npm run backfill:ruleset              # DRY RUN — reports, writes nothing
//   npm run backfill:ruleset -- --apply
//
// TWO SOURCES, AND ONLY TWO. Neither guesses.
//
//   1. The bout's own weight class, where the ruleset survived in the stored
//      string ("Featherweight Muay Thai"). Confidence 1 — the source said it.
//
//   2. The event's sport, ONLY where that promotion runs a single ruleset.
//      A GLORY card is kickboxing throughout, so the card does answer for the
//      bout. Confidence 0.8 — sound, but a step removed.
//
// An MMA-labelled event maps to NOTHING, deliberately. MMA is both a real
// ruleset and the label every mixed card carries, so an MMA event cannot tell
// us whether a given bout on it was MMA — that is the whole defect this column
// exists to fix, and filling it from the event would rebuild it in the data.
// Those bouts stay UNKNOWN until a re-ingest states the ruleset per bout.
import { prisma } from "../src/lib/db.ts";
import { toRuleset, rulesetFromSingleRulesetSport, RULESET_CONFIDENCE } from "../src/lib/scraper/ruleset.ts";
import type { Sport } from "../src/lib/types.ts";
import type { Ruleset } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const BATCH = 500;

async function main() {
  console.log(`\n  Ruleset backfill — ${APPLY ? "APPLYING" : "DRY RUN (nothing written)"}\n`);

  const total = await prisma.fight.count();
  const unknownBefore = await prisma.fight.count({ where: { ruleset: "UNKNOWN" } });
  console.log(`  ${total} bouts, ${unknownBefore} currently UNKNOWN\n`);

  const fights = await prisma.fight.findMany({
    where: { ruleset: "UNKNOWN" },
    select: {
      id: true,
      weightClass: { select: { name: true } },
      event: { select: { sport: true, promotion: true } },
    },
  });

  const plan = new Map<string, { ruleset: Ruleset; confidence: number; source: string }>();
  const bySource = new Map<string, number>();
  const unresolvedBySport = new Map<string, number>();

  for (const f of fights) {
    // 1. Stated on the bout.
    const stated = toRuleset(f.weightClass?.name);
    if (stated) {
      plan.set(f.id, { ruleset: stated, confidence: RULESET_CONFIDENCE.stated, source: "weight-class:stated" });
      bySource.set("weight-class:stated", (bySource.get("weight-class:stated") ?? 0) + 1);
      continue;
    }

    // 2. Implied by a single-ruleset promotion.
    const implied = rulesetFromSingleRulesetSport(f.event?.sport as Sport | undefined);
    if (implied) {
      plan.set(f.id, {
        ruleset: implied,
        confidence: RULESET_CONFIDENCE.singleRulesetPromotion,
        source: "event:single-ruleset-sport",
      });
      bySource.set("event:single-ruleset-sport", (bySource.get("event:single-ruleset-sport") ?? 0) + 1);
      continue;
    }

    // Neither. Stays UNKNOWN — recorded so the gap has a shape.
    const s = f.event?.sport ?? "(no event)";
    unresolvedBySport.set(s, (unresolvedBySport.get(s) ?? 0) + 1);
  }

  console.log("  Resolvable:");
  for (const [src, n] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${n.toString().padStart(6)}  ${src}`);
  }
  console.log("\n  Staying UNKNOWN (no source states the ruleset):");
  for (const [s, n] of [...unresolvedBySport.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${n.toString().padStart(6)}  events labelled ${s}`);
  }
  console.log(`\n  ${plan.size} bout(s) would be filled; ${fights.length - plan.size} stay UNKNOWN.`);

  if (!APPLY) {
    console.log("\n  DRY RUN — nothing written. Re-run with --apply.\n");
    return;
  }

  // Grouped by (ruleset, confidence, source) so this is a handful of updateMany
  // calls rather than one round-trip per bout.
  const groups = new Map<string, { ids: string[]; ruleset: Ruleset; confidence: number; source: string }>();
  for (const [id, v] of plan) {
    const key = `${v.ruleset}|${v.confidence}|${v.source}`;
    const g = groups.get(key) ?? { ids: [], ...v };
    g.ids.push(id);
    groups.set(key, g);
  }

  const now = new Date();
  let written = 0;
  for (const g of groups.values()) {
    for (let i = 0; i < g.ids.length; i += BATCH) {
      const slice = g.ids.slice(i, i + BATCH);
      const res = await prisma.fight.updateMany({
        where: { id: { in: slice } },
        data: {
          ruleset: g.ruleset,
          rulesetConfidence: g.confidence,
          rulesetSource: g.source,
          rulesetUpdatedAt: now,
        },
      });
      written += res.count;
    }
  }

  const unknownAfter = await prisma.fight.count({ where: { ruleset: "UNKNOWN" } });
  console.log(`\n  ${written} bout(s) filled.`);
  console.log(`  UNKNOWN: ${unknownBefore} -> ${unknownAfter}\n`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
