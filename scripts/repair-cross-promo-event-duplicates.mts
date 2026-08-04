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
// Survivor rule (CORRECTED 2026-08-04, after a production run of the first
// version silently deleted 2 real bouts — see the incident note below):
// the row with MORE bouts wins, full stop. Named-vs-null is a TIEBREAKER
// only, used when bout counts are equal. The first version had this
// backwards — "named beats null" as the PRIMARY rule — which was correct
// for the 7 cases this was built and tested against (all 100% identical
// bout counts on both sides) and wrong the moment it hit a case where the
// null-tagged side actually had MORE, more-complete data.
//
// Non-overlapping fights on the dropped side are MOVED to the survivor, not
// deleted — only fights whose fighter-pair already exists on the survivor
// are deleted as true duplicates. The first version deleted ALL of the
// dropped side's fights unconditionally, assuming full duplication; that
// assumption failed the moment overlap was 100% of the SMALLER side but not
// 100% of the LARGER one.
//
// SYNTHETIC CONTAINER GUARD: a "Boxing — DD Mon YYYY" / "MMA — DD Mon YYYY"
// style event (see SYNTHETIC below, same pattern classify-duplicates.mts
// already treats as KEEP, never a merge candidate) is a many-card daily
// placeholder, not one real card — it can legitimately share a fighter pair
// with an individual real event without being that event's duplicate; it
// might hold several OTHER unrelated real fights for the same day. Auto
// merging it is not a same-card resolution, it's a different, harder
// problem. This version skips any pair where either side matches and
// reports it for a human instead of guessing.
//
// ── INCIDENT, 2026-08-04 ────────────────────────────────────────────────
// The first version of this script ran against PRODUCTION (not just local
// dev) and merged "MVPW 5: Johnson vs. Thorslund" [NULL] (4 bouts) INTO
// "Boxing — 09 Aug 2026" [Various] (2 bouts) — kept the container because it
// had a non-null promotion, then deleted all 4 of MVPW 5's fight rows
// unconditionally. Only 2 of those 4 were actually already present on the
// survivor. The other 2 real, unique bouts were deleted, not moved.
// A second pair ("Nyika vs. Masson" -> "Boxing — 08 Aug 2026") lost only the
// dedicated event's identity (name/slug), not bout data — full overlap.
// A pre-repair Render Postgres backup exists; recovery of the 2 lost MVPW
// bouts is a separate, targeted operation against that backup, not
// something this corrected script can undo on its own (it does not know
// what it deleted). Do not re-run this script against production without
// first confirming the specific pairs in its dry-run output again — data
// changes; a plan verified once is not verified forever.
//
// NEVER LOSE USER-GENERATED DATA — same rule as merge-entity-duplicates.mts,
// same mechanism: every relation is re-pointed to the survivor, and where a
// relation can't move (the survivor already has one, and the column is
// unique) the script says so rather than silently dropping it.
import { prisma } from "../src/lib/db.ts";

const SYNTHETIC = /^(boxing|mma|muay thai|kickboxing|bjj|wrestling|judo|taekwondo|sambo)\s+[-—–]\s+\d{1,2}\s+\w{3}\s+\d{4}$/i;

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
        if (SYNTHETIC.test(a.name.trim()) || SYNTHETIC.test(b.name.trim())) {
          console.log(`  SKIP (synthetic daily container, needs a human)  "${a.name}" [${a.promotion ?? "NULL"}] vs "${b.name}" [${b.promotion ?? "NULL"}]`);
          skippedPartialOverlap++;
          continue;
        }

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

        // 100% overlap on the smaller side, but the LARGER side may still hold
        // fights the smaller one doesn't — that's exactly the shape that broke
        // the first version of this script. MORE BOUTS wins, full stop; named
        // vs null is a tiebreaker only, used when bout counts are equal.
        let keep = a, drop = b;
        if (b.fights.length !== a.fights.length) {
          keep = b.fights.length > a.fights.length ? b : a;
          drop = keep === a ? b : a;
        } else if (a.promotion !== null && b.promotion === null) {
          keep = a; drop = b;
        } else if (b.promotion !== null && a.promotion === null) {
          keep = b; drop = a;
        }
        const keepPairs = keep === a ? aPairs : bPairs;

        console.log(`  MERGE  "${drop.name}" [${drop.promotion ?? "NULL"}] (${drop.fights.length} bouts, ${drop.slug})`);
        console.log(`         -> "${keep.name}" [${keep.promotion ?? "NULL"}] (${keep.fights.length} bouts, ${keep.slug})`);
        const carried = drop._count.followers + drop._count.checkIns + (drop.discussionThread ? 1 : 0);
        if (carried) console.log(`         carrying ${drop._count.followers} follower(s), ${drop._count.checkIns} check-in(s)${drop.discussionThread ? ", 1 discussion thread" : ""}`);

        if (APPLY) {
          await prisma.$transaction(async (tx) => {
            // Only fights whose fighter-pair is ALREADY on the survivor are
            // true duplicates and get deleted. Anything else on the dropped
            // side is real, distinct data and gets MOVED, not deleted — the
            // first version of this script deleted every fight on the
            // dropped side unconditionally, which is what lost 2 real bouts
            // in production on 2026-08-04 when the dropped side (4 bouts)
            // turned out to hold more than the survivor (2 bouts) did.
            const dropFights = await tx.fight.findMany({ where: { eventId: drop.id }, select: { id: true, redId: true, blueId: true } });
            const dupFightIds = dropFights.filter((f) => keepPairs.has(pairKey(f.redId, f.blueId))).map((f) => f.id);
            const uniqueFightIds = dropFights.filter((f) => !keepPairs.has(pairKey(f.redId, f.blueId))).map((f) => f.id);

            if (dupFightIds.length) {
              const del = await tx.fight.deleteMany({ where: { id: { in: dupFightIds } } });
              bump("duplicate fight rows deleted", del.count);
            }
            if (uniqueFightIds.length) {
              const mov = await tx.fight.updateMany({ where: { id: { in: uniqueFightIds } }, data: { eventId: keep.id } });
              bump("unique fight rows moved (not deleted)", mov.count);
            }

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
