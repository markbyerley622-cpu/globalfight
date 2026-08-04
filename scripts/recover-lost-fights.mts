// One-off recovery for the real bouts deleted by repair-cross-promo-event-
// duplicates.mts's first (buggy) production run on 2026-08-04 — see the
// INCIDENT note in that script. Reads the ORIGINAL event+fights from a
// RESTORED pre-repair backup, checks each original bout against what's
// currently live (by fighter pair — Fighter rows were never touched by the
// repair, so ids carry over unchanged), and re-creates whatever is missing,
// pointed at wherever that card's surviving bouts currently live.
//
// Needs TWO database connections:
//   SOURCE_DATABASE_URL   the RESTORED BACKUP (read-only — never written to)
//   DATABASE_URL          LIVE PRODUCTION (only place anything is written)
//
//   SOURCE_DATABASE_URL="<restored-backup-url>" npm run recover:lost-fights
//       # DRY RUN — reports exactly what it would insert, writes nothing
//   SOURCE_DATABASE_URL="<restored-backup-url>" npm run recover:lost-fights -- --apply
//
// Scope is deliberately narrow: this looks ONLY at the two event slugs
// below, not a general "diff two databases" tool. Don't repurpose it.
import { PrismaClient } from "@prisma/client";
import { prisma as liveDb } from "../src/lib/db.ts";

const APPLY = process.argv.slice(2).includes("--apply");

const AFFECTED_SLUGS = ["mvpw-5-johnson-vs-thorslund", "nyika-vs-masson"] as const;

async function main() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  if (!sourceUrl) {
    console.error("Set SOURCE_DATABASE_URL to the RESTORED BACKUP's connection string first.");
    process.exit(1);
  }
  const backupDb = new PrismaClient({ datasources: { db: { url: sourceUrl } } });

  console.log(`\n  Lost-fight recovery — ${APPLY ? "APPLYING (writes to LIVE production)" : "DRY RUN (nothing will be written)"}\n`);

  let totalMissing = 0;
  for (const slug of AFFECTED_SLUGS) {
    const original = await backupDb.event.findUnique({
      where: { slug },
      select: {
        name: true,
        fights: {
          select: {
            redId: true, blueId: true, weightClassId: true, scheduledRounds: true,
            titleFight: true, interimTitle: true, mainEvent: true, coMain: true,
            ruleset: true, rulesetConfidence: true, rulesetSource: true,
            method: true, roundEnded: true, timeEnded: true, winnerId: true, result: true,
            date: true, cardSegment: true, cancelled: true, cardNote: true,
            red: { select: { name: true } }, blue: { select: { name: true } },
          },
        },
      },
    });
    if (!original) {
      console.log(`  "${slug}" — not found in the backup. Nothing to recover from here.`);
      continue;
    }

    console.log(`\n  "${original.name}" (${slug}): ${original.fights.length} bout(s) in the backup`);

    let survivorEventId: string | null = null;
    // Two passes, deliberately: pass 1 finds every present fight AND the
    // survivor event id first; pass 2 handles the missing ones. A single
    // combined pass depends on array order — if a missing fight happens to
    // be iterated before any present one, survivorEventId isn't known yet
    // even though a later fight in the SAME card would have supplied it.
    // Caught this exact ordering bug in local testing before it could hit
    // production: the recovery reported the right MISSING list but skipped
    // the actual recreation because it checked too early.
    const missing: typeof original.fights = [];
    for (const f of original.fights) {
      const stillThere = await liveDb.fight.findFirst({
        where: { OR: [{ redId: f.redId, blueId: f.blueId }, { redId: f.blueId, blueId: f.redId }] },
        select: { id: true, eventId: true },
      });
      if (stillThere) {
        console.log(`    present   ${f.red.name} vs ${f.blue.name}`);
        survivorEventId ??= stillThere.eventId;
      } else {
        missing.push(f);
      }
    }

    for (const f of missing) {
      totalMissing++;
      console.log(`    MISSING   ${f.red.name} vs ${f.blue.name} — not found anywhere in current production`);

      if (APPLY) {
        if (!survivorEventId) {
          console.log(`      SKIPPED — no surviving fight found anywhere on this card, can't determine which event to attach to. Needs a human.`);
          continue;
        }
        // Confirm both fighters still exist under the same ids in live prod
        // before writing anything that references them.
        const [red, blue] = await Promise.all([
          liveDb.fighter.findUnique({ where: { id: f.redId }, select: { id: true } }),
          liveDb.fighter.findUnique({ where: { id: f.blueId }, select: { id: true } }),
        ]);
        if (!red || !blue) {
          console.log(`      SKIPPED — fighter id(s) no longer exist in live production (${!red ? f.red.name : ""} ${!blue ? f.blue.name : ""}). Needs a human.`);
          continue;
        }
        const created = await liveDb.fight.create({
          data: {
            slug: `${slug}-recovered-${f.redId.slice(-6)}-${f.blueId.slice(-6)}`,
            eventId: survivorEventId,
            redId: f.redId, blueId: f.blueId,
            weightClassId: f.weightClassId ?? undefined,
            scheduledRounds: f.scheduledRounds,
            titleFight: f.titleFight, interimTitle: f.interimTitle,
            mainEvent: f.mainEvent, coMain: f.coMain,
            ruleset: f.ruleset, rulesetConfidence: f.rulesetConfidence ?? undefined, rulesetSource: f.rulesetSource ?? undefined,
            method: f.method ?? undefined, roundEnded: f.roundEnded ?? undefined, timeEnded: f.timeEnded ?? undefined,
            winnerId: f.winnerId ?? undefined, result: f.result,
            date: f.date, cardSegment: f.cardSegment ?? undefined,
            cancelled: f.cancelled, cardNote: f.cardNote ?? undefined,
          },
        });
        console.log(`      RECREATED as fight ${created.id} on event ${survivorEventId}`);
      }
    }
  }

  console.log(`\n  ── Report ─────────────────────────────────────────────`);
  console.log(`  bouts missing from current production   ${totalMissing}`);
  if (!APPLY) console.log(`\n  DRY RUN — nothing was written. Confirm the MISSING list looks right, then re-run with --apply.`);
  console.log("");

  await backupDb.$disconnect();
  await liveDb.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
