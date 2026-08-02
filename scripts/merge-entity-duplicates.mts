// One-time repair for events whose NAME was stored with HTML entities intact,
// and for the duplicate rows that corruption created.
//
//   npm run repair:entity-duplicates             # DRY RUN — reports, writes nothing
//   npm run repair:entity-duplicates -- --apply  # perform the merge
//
// ── WHAT WENT WRONG ────────────────────────────────────────────────────────
//
// ONE's extractor hand-rolled `.replace(/&amp;/g, "&")`, which handles one
// entity out of the three its JSON-LD emits. Eight cards were stored as
// "Kings &#038; Champions" and slugged `kings-038-champions`, while the SAME
// cards arrived from Wikipedia correctly named. Event matching compared an
// encoded string with a decoded one, correctly decided they were different
// events, and wrote a second row per card — the encoded copy holding zero
// bouts, the decoded one holding the whole card.
//
// The extractor and the persist chokepoint are fixed; this repairs what they
// already wrote.
//
// ── THE RULE THIS SCRIPT OBEYS ─────────────────────────────────────────────
//
// NEVER LOSE USER-GENERATED DATA. Picks, follows, check-ins and discussion
// belong to people, not to whichever row an importer happened to create. So
// every relation is RE-POINTED to the surviving event before the duplicate is
// deleted, and where a relation cannot move (the target already has one, and
// the column is unique) the script says so rather than dropping it.
import { prisma } from "../src/lib/db.ts";
import { hasHtmlEntity, normalizeText, canonicalizeTitle } from "../src/lib/text/entities.ts";
import { slugify } from "../src/lib/utils.ts";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");

const started = Date.now();
let renamed = 0, merged = 0, skipped = 0, conflicts = 0;
const rowsMoved: Record<string, number> = {};
const bump = (k: string, n: number) => { if (n) rowsMoved[k] = (rowsMoved[k] ?? 0) + n; };

/** Same day, ignoring time — sources disagree on the hour, never on the date. */
const sameDay = (a: Date, b: Date) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

/**
 * Is `other` the correctly-named twin of `encoded`?
 *
 * Canonical titles are compared with endsWith rather than equality because the
 * two sources bill the same card differently: ONE's own page says "Kings &
 * Champions" while Wikipedia says "ONE Fighting Championship: Kings and
 * Champions". The promotion prefix is the only difference, so one canonical key
 * is a suffix of the other. Requiring same promotion AND same day keeps that
 * from over-matching.
 */
function isTwin(encodedTitle: string, otherTitle: string): boolean {
  const a = canonicalizeTitle(encodedTitle);
  const b = canonicalizeTitle(otherTitle);
  if (!a || !b) return false;
  if (a === b) return true;
  // Guard against a trivially short key matching half the schedule.
  if (a.length < 6) return false;
  return b.endsWith(a) || a.endsWith(b);
}

async function main() {
  console.log(`\n  Entity-duplicate repair — ${APPLY ? "APPLYING" : "DRY RUN (nothing will be written)"}\n`);

  const all = await prisma.event.findMany({
    select: {
      id: true, slug: true, name: true, promotion: true, date: true, createdAt: true,
      _count: { select: { fights: true, followers: true, checkIns: true } },
      discussionThread: { select: { id: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const encoded = all.filter((e) => hasHtmlEntity(e.name));
  console.log(`  ${all.length} events, ${encoded.length} with HTML entities in the name\n`);
  if (encoded.length === 0) {
    console.log("  Nothing to repair.\n");
    return;
  }

  for (const bad of encoded) {
    const fixedName = normalizeText(bad.name);
    const twins = all.filter(
      (o) =>
        o.id !== bad.id &&
        !hasHtmlEntity(o.name) &&
        sameDay(o.date, bad.date) &&
        (o.promotion ?? "") === (bad.promotion ?? "") &&
        isTwin(bad.name, o.name),
    );

    // ── No twin: the row is simply mis-named. Decode it in place. ───────────
    if (twins.length === 0) {
      console.log(`  RENAME  "${bad.name}" -> "${fixedName}"`);
      console.log(`          slug ${bad.slug} (kept — changing it would break existing links)`);
      renamed++;
      if (APPLY) await prisma.event.update({ where: { id: bad.id }, data: { name: fixedName } });
      continue;
    }

    if (twins.length > 1) {
      console.log(`  SKIP    "${bad.name}" — ${twins.length} candidate twins, ambiguous:`);
      for (const t of twins) console.log(`          ${t.slug} (${t._count.fights} bouts)`);
      skipped++;
      continue;
    }

    // ── One twin: merge. The row with the BOUTS survives. ───────────────────
    const twin = twins[0];
    const keep = twin._count.fights >= bad._count.fights ? twin : bad;
    const drop = keep.id === twin.id ? bad : twin;

    console.log(`  MERGE   ${drop.slug} (${drop._count.fights} bouts) -> ${keep.slug} (${keep._count.fights} bouts)`);
    console.log(`          "${drop.name}" into "${keep.name}"`);

    const carried =
      drop._count.followers + drop._count.checkIns + (drop.discussionThread ? 1 : 0);
    if (carried) console.log(`          carrying ${drop._count.followers} follower(s), ${drop._count.checkIns} check-in(s)${drop.discussionThread ? ", 1 discussion thread" : ""}`);

    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        // Bouts move wholesale — Fight.eventId is nullable and not unique.
        const f = await tx.fight.updateMany({ where: { eventId: drop.id }, data: { eventId: keep.id } });
        bump("fights", f.count);

        // FavoriteEvent has a composite PK (userId, eventId): a user following
        // BOTH rows would collide, so those are deleted rather than moved —
        // they already follow the survivor.
        const dupFollows = await tx.favoriteEvent.findMany({
          where: { eventId: drop.id, user: { eventFollows: { some: { eventId: keep.id } } } },
          select: { userId: true },
        });
        if (dupFollows.length) {
          await tx.favoriteEvent.deleteMany({
            where: { eventId: drop.id, userId: { in: dupFollows.map((d) => d.userId) } },
          });
          bump("follows already on the survivor (dropped)", dupFollows.length);
        }
        const fav = await tx.favoriteEvent.updateMany({ where: { eventId: drop.id }, data: { eventId: keep.id } });
        bump("follows", fav.count);

        const ci = await tx.checkIn.updateMany({ where: { eventId: drop.id }, data: { eventId: keep.id } });
        bump("check-ins", ci.count);

        // EventExternalId is unique on (source, externalId), so a provenance row
        // that already exists on the survivor cannot move. Keeping the survivor's
        // is correct — it is the same claim from the same source.
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

        // ForumThread.eventId is @unique. If the survivor already has a general
        // room, the duplicate's thread is DETACHED rather than deleted — the
        // posts in it are people's words and must not vanish.
        if (drop.discussionThread) {
          if (keep.discussionThread) {
            await tx.forumThread.update({ where: { id: drop.discussionThread.id }, data: { eventId: null } });
            bump("discussion threads detached (survivor already had one)", 1);
            conflicts++;
          } else {
            await tx.forumThread.update({ where: { id: drop.discussionThread.id }, data: { eventId: keep.id } });
            bump("discussion threads", 1);
          }
        }

        await tx.event.delete({ where: { id: drop.id } });

        // The survivor keeps its own (correct) name, but if IT was the encoded
        // one — because it held the bouts — decode it now.
        if (hasHtmlEntity(keep.name)) {
          const clean = normalizeText(keep.name);
          const wanted = slugify(clean);
          const slugTaken = await tx.event.findFirst({ where: { slug: wanted, id: { not: keep.id } }, select: { id: true } });
          await tx.event.update({
            where: { id: keep.id },
            data: { name: clean, ...(slugTaken ? {} : { slug: wanted }) },
          });
        }
      });
    }
    merged++;
  }

  // ── Report ───────────────────────────────────────────────────────────────
  console.log(`\n  ── Report ─────────────────────────────────────────────`);
  console.log(`  duplicates merged        ${merged}`);
  console.log(`  renamed in place         ${renamed}`);
  console.log(`  skipped (ambiguous)      ${skipped}`);
  console.log(`  conflicts resolved       ${conflicts}`);
  for (const [k, v] of Object.entries(rowsMoved)) console.log(`  ${k.padEnd(24)} ${v}`);
  console.log(`  execution time           ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (!APPLY) console.log(`\n  DRY RUN — nothing was written. Re-run with --apply.`);
  console.log("");
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
