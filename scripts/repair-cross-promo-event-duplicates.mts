// Repair for the duplicate-event pattern found 2026-08-04 while investigating
// why real professional boxers were failing a "not exclusively Misfits" check
// despite having real non-Misfits bouts on file: several Misfits Boxing cards
// that also drew mainstream press (KSI vs Tommy Fury, Chisora vs Wilder) were
// imported TWICE — once correctly tagged `promotion: "Misfits Boxing"` by the
// promotion-index scraper, once again with `promotion: NULL` by the general
// Wikipedia "notable boxing matches" category scraper, which doesn't attempt
// to attribute a promoter. classify-duplicates.mts / audit:duplicates does
// NOT catch this: it only compares events that already share a non-null
// promotion key, so a null-vs-named pair is invisible to it by construction.
//
//   npm run repair:cross-promo-dupes              # DRY RUN — reports, writes nothing
//   npm run repair:cross-promo-dupes -- --apply   # perform the merge
//
// Detection: same calendar date, different promotion VALUES (one may be
// null), and 100% of one side's fighter-pairs (red/blue, either order) exist
// on the other side too. That last condition is deliberately strict —
// PARTIAL overlap is not attempted here; a card that shares one fighter with
// another card on the same day is not evidence of the same card, and this
// script says so and skips it rather than guessing.
//
// Survivor rule: the row with a NAMED promotion wins over the NULL row, full
// stop — keeping the null-tagged twin would put the exact same bug right
// back (a real fighter's genuine non-Misfits evidence still hiding under
// promotion NULL is fine; a real fighter's ONLY Misfits evidence sitting
// under promotion NULL, masquerading as "outside" evidence, is the bug).
// If both sides are named (shouldn't occur given the detection filter, but
// checked), the row with MORE bouts wins, matching merge-entity-duplicates.mts.
//
// NEVER LOSE USER-GENERATED DATA — same rule as merge-entity-duplicates.mts,
// same mechanism: every relation is re-pointed to the survivor, and where a
// relation can't move (the survivor already has one, and the column is
// unique) the script says so rather than silently dropping it.
import { prisma } from "../src/lib/db.ts";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");

const started = Date.now();
let merged = 0, skippedPartialOverlap = 0, conflicts = 0;
const rowsMoved: Record<string, number> = {};
const bump = (k: string, n: number) => { if (n) rowsMoved[k] = (rowsMoved[k] ?? 0) + n; };

const pairKey = (redId: string, blueId: string) => [redId, blueId].sort().join("|");

async function main() {
  console.log(`\n  Cross-promotion-boundary event-duplicate repair — ${APPLY ? "APPLYING" : "DRY RUN (nothing will be written)"}\n`);

  const events = await prisma.event.findMany({
    where: { sport: "BOXING" },
    select: {
      id: true, slug: true, name: true, promotion: true, date: true,
      fights: { select: { redId: true, blueId: true } },
      _count: { select: { followers: true, checkIns: true } },
      discussionThread: { select: { id: true } },
    },
    orderBy: { date: "asc" },
  });

  const byDate = new Map<string, typeof events>();
  for (const e of events) {
    const day = e.date.toISOString().slice(0, 10);
    (byDate.get(day) ?? byDate.set(day, []).get(day)!).push(e);
  }

  const handled = new Set<string>(); // event ids already merged this run
  for (const [, dayEvents] of byDate) {
    if (dayEvents.length < 2) continue;
    for (let i = 0; i < dayEvents.length; i++) {
      for (let j = i + 1; j < dayEvents.length; j++) {
        const a = dayEvents[i], b = dayEvents[j];
        if (handled.has(a.id) || handled.has(b.id)) continue;
        if (a.promotion === b.promotion) continue; // same-promotion dupes are classify-duplicates.mts's job
        if (a.fights.length === 0 || b.fights.length === 0) continue; // nothing to compare

        const aPairs = new Set(a.fights.map((f) => pairKey(f.redId, f.blueId)));
        const bPairs = new Set(b.fights.map((f) => pairKey(f.redId, f.blueId)));
        const smaller = aPairs.size <= bPairs.size ? aPairs : bPairs;
        const larger = smaller === aPairs ? bPairs : aPairs;
        const overlap = [...smaller].filter((k) => larger.has(k)).length;

        if (overlap === 0) continue; // unrelated cards on the same day — leave alone
        if (overlap < smaller.size) {
          console.log(`  SKIP (partial overlap ${overlap}/${smaller.size})  "${a.name}" [${a.promotion ?? "NULL"}] vs "${b.name}" [${b.promotion ?? "NULL"}]`);
          skippedPartialOverlap++;
          continue;
        }

        // 100% overlap on the smaller side. Named promotion wins; else more bouts wins.
        const aNamed = a.promotion !== null, bNamed = b.promotion !== null;
        let keep = a, drop = b;
        if (aNamed !== bNamed) {
          keep = aNamed ? a : b;
          drop = aNamed ? b : a;
        } else if (b.fights.length > a.fights.length) {
          keep = b; drop = a;
        }

        console.log(`  MERGE  "${drop.name}" [${drop.promotion ?? "NULL"}] (${drop.fights.length} bouts, ${drop.slug})`);
        console.log(`         -> "${keep.name}" [${keep.promotion ?? "NULL"}] (${keep.fights.length} bouts, ${keep.slug})`);
        const carried = drop._count.followers + drop._count.checkIns + (drop.discussionThread ? 1 : 0);
        if (carried) console.log(`         carrying ${drop._count.followers} follower(s), ${drop._count.checkIns} check-in(s)${drop.discussionThread ? ", 1 discussion thread" : ""}`);

        if (APPLY) {
          await prisma.$transaction(async (tx) => {
            // The dropped row's Fight rows are the SAME bouts as the survivor's
            // (that's the whole detection criterion) — deleting them, not
            // moving them, or the survivor would end up with each bout twice.
            const del = await tx.fight.deleteMany({ where: { eventId: drop.id } });
            bump("duplicate fight rows deleted", del.count);

            const dupFollows = await tx.favoriteEvent.findMany({
              where: { eventId: drop.id, user: { eventFollows: { some: { eventId: keep.id } } } },
              select: { userId: true },
            });
            if (dupFollows.length) {
              await tx.favoriteEvent.deleteMany({ where: { eventId: drop.id, userId: { in: dupFollows.map((d) => d.userId) } } });
              bump("follows already on the survivor (dropped)", dupFollows.length);
            }
            const fav = await tx.favoriteEvent.updateMany({ where: { eventId: drop.id }, data: { eventId: keep.id } });
            bump("follows", fav.count);

            const ci = await tx.checkIn.updateMany({ where: { eventId: drop.id }, data: { eventId: keep.id } });
            bump("check-ins", ci.count);

            const ext = await tx.eventExternalId.findMany({ where: { eventId: drop.id }, select: { id: true, source: true, externalId: true } });
            for (const x of ext) {
              const clash = await tx.eventExternalId.findUnique({
                where: { source_externalId: { source: x.source, externalId: x.externalId } },
                select: { eventId: true },
              });
              if (clash && clash.eventId !== drop.id) { conflicts++; continue; }
              await tx.eventExternalId.update({ where: { id: x.id }, data: { eventId: keep.id } });
              bump("provenance links", 1);
            }

            if (drop.discussionThread) {
              const survivorThread = await tx.forumThread.findUnique({ where: { eventId: keep.id }, select: { id: true } });
              if (survivorThread) {
                await tx.forumThread.update({ where: { id: drop.discussionThread.id }, data: { eventId: null } });
                bump("discussion threads detached (survivor already had one)", 1);
                conflicts++;
              } else {
                await tx.forumThread.update({ where: { id: drop.discussionThread.id }, data: { eventId: keep.id } });
                bump("discussion threads", 1);
              }
            }

            await tx.event.delete({ where: { id: drop.id } });
          });
        }

        handled.add(a.id);
        handled.add(b.id);
        merged++;
      }
    }
  }

  console.log(`\n  ── Report ─────────────────────────────────────────────`);
  console.log(`  duplicate pairs merged      ${merged}`);
  console.log(`  skipped (partial overlap)   ${skippedPartialOverlap}`);
  console.log(`  conflicts resolved          ${conflicts}`);
  for (const [k, v] of Object.entries(rowsMoved)) console.log(`  ${k.padEnd(30)} ${v}`);
  console.log(`  execution time               ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (!APPLY) console.log(`\n  DRY RUN — nothing was written. Re-run with --apply.`);
  console.log("");
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
