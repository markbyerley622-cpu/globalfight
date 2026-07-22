/**
 * One-off repair: User.sportPrefs stored in TWO vocabularies.
 *
 * Onboarding has always written canonical sport VALUES ("MUAY_THAI"). The
 * profile editor briefly wrote display LABELS ("Muay Thai") into the same
 * column, so a single user could hold both and every `sport IN (...)` filter
 * silently skipped the label rows.
 *
 * The write path is fixed (src/app/api/profile/route.ts now validates against
 * SPORTS values). This normalises rows written while it was broken.
 *
 * Idempotent — safe to run repeatedly. Reports what it would change first.
 *
 *   node --env-file=.env --import tsx scripts/repair-sport-prefs.mts          # dry run
 *   node --env-file=.env --import tsx scripts/repair-sport-prefs.mts --apply  # write
 */
import { PrismaClient } from "@prisma/client";
import { SPORTS } from "../src/lib/sports";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

// label → value, for every sport whose label differs from its value.
const BY_LABEL = new Map(SPORTS.filter((s) => s.label !== s.value).map((s) => [s.label, s.value]));
const VALUES = new Set(SPORTS.map((s) => s.value));

async function main() {
  const users = await prisma.user.findMany({
    where: { sportPrefs: { isEmpty: false } },
    select: { id: true, username: true, sportPrefs: true },
  });

  let changed = 0;
  for (const u of users) {
    // Map labels onto values, drop anything unrecognised, de-duplicate.
    const next = [...new Set(u.sportPrefs.map((s) => BY_LABEL.get(s) ?? s).filter((s) => VALUES.has(s)))];

    const same =
      next.length === u.sportPrefs.length && next.every((s, i) => s === u.sportPrefs[i]);
    if (same) continue;

    changed++;
    console.log(`${apply ? "FIX " : "WOULD FIX "}${u.username ?? u.id}: ${JSON.stringify(u.sportPrefs)} → ${JSON.stringify(next)}`);
    if (apply) {
      await prisma.user.update({ where: { id: u.id }, data: { sportPrefs: next } });
    }
  }

  console.log(
    changed === 0
      ? `\nNothing to repair — all ${users.length} users already use canonical values.`
      : `\n${apply ? "Repaired" : "Would repair"} ${changed} of ${users.length} users.${apply ? "" : " Re-run with --apply."}`,
  );
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
