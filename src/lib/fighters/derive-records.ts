import "server-only";
import { prisma } from "@/lib/db";

// ════════════════════════════════════════════════════════════════════════
//  Fighter win/loss records, DERIVED from the bouts we hold.
//
//  Fighter.wins / losses / draws / noContests / koWins were only ever set by
//  providers that happened to publish a record alongside a roster. Every
//  provider that writes BOUTS — ESPN, the Wikipedia card/year/index paths, the
//  tournament path, BKFC — writes the bout and leaves the two fighters' records
//  untouched.
//
//  Measured 2026-08-03: 13 fighters out of 10,419 had a non-zero record, while
//  the database held 13,603 decided bouts. Judo alone had 2,090 decided bouts
//  and not one judoka with a record.
//
//  What that cost, in order of visibility:
//    • Every fighter profile, card, ranking row and search result showed a BLANK
//      record — formatSportRecord() returns "" when all counters are zero, so it
//      rendered as absence rather than as "0-0-0".
//    • No pound-for-pound list could be generated for ANY sport. The rating
//      engine reads these columns, so isRankable() rejected all 10,419 fighters
//      and every generated ranking was empty — which read as "the ranking engine
//      is broken" rather than "its input was never populated".
//
//  DERIVED, NOT AUTHORITATIVE. This counts the bouts WE hold, which is a floor,
//  not a fighter's true professional record — a judoka with 40 IJF matches whose
//  first 20 we never ingested will read 12-8 here. That is why it never
//  overwrites a record a provider actually published (see `preservePublished`):
//  a real 27-3 must not be replaced by our partial 12-8.
// ════════════════════════════════════════════════════════════════════════

export interface DerivedRecord {
  fighterId: string;
  wins: number; losses: number; draws: number; noContests: number; koWins: number;
}

export interface DeriveSummary {
  scanned: number;
  updated: number;
  unchanged: number;
  /** Fighters skipped because a provider had already published a fuller record. */
  preserved: number;
}

/**
 * When may a derived record overwrite what is stored?
 *
 *   fill   only a fighter with NO record at all. The safe first pass.
 *   grow   also a fighter whose stored record accounts for FEWER bouts than we
 *          now hold. This is the one the cron wants: it keeps records current as
 *          new results land, and still cannot replace a fuller published career
 *          record with our partial one.
 *   force  every fighter, unconditionally. Correct only once bout coverage for
 *          a sport is genuinely complete.
 *
 * `fill` alone is not enough for a scheduled job, and the reason is easy to miss:
 * after one successful backfill EVERY fighter has a record, so a `fill` cron
 * skips all of them forever and the records freeze at their backfill values
 * while new bouts keep arriving. It would look like it was running fine.
 */
export type DeriveMode = "fill" | "grow" | "force";

// Finishes that count as a knockout win. Written literally into the query
// below rather than interpolated: a Prisma tagged template turns `${...}` into
// a single BOUND PARAMETER, so `IN (${list.join(",")})` compiles to `IN ($1)`
// matching the one literal string "KO,TKO" and therefore nothing at all.

/**
 * Count every decided bout, per fighter, from both corners at once.
 *
 * One SQL pass rather than a query per fighter: at 10k fighters the per-fighter
 * form is 10k round-trips against a database this project has already measured
 * as slow under memory pressure.
 *
 * A bout counts as a WIN for whoever `winnerId` names, and a LOSS for the other
 * corner. `result` is deliberately NOT used to decide win/loss — it is stored
 * from the RED corner's point of view on some import paths, so trusting it would
 * hand every blue-corner winner a loss. DRAW and NO_CONTEST come from `result`,
 * because those are symmetrical and carry no winner.
 */
export async function computeRecords(): Promise<DerivedRecord[]> {
  return prisma.$queryRaw<DerivedRecord[]>`
    WITH sides AS (
      SELECT "redId" AS fighter_id, "winnerId", result, method FROM "Fight" WHERE result <> 'SCHEDULED' AND cancelled = false
      UNION ALL
      SELECT "blueId" AS fighter_id, "winnerId", result, method FROM "Fight" WHERE result <> 'SCHEDULED' AND cancelled = false
    )
    SELECT fighter_id AS "fighterId",
           COUNT(*) FILTER (WHERE "winnerId" = fighter_id)::int AS wins,
           COUNT(*) FILTER (WHERE "winnerId" IS NOT NULL AND "winnerId" <> fighter_id
                              AND result NOT IN ('DRAW','NO_CONTEST'))::int AS losses,
           COUNT(*) FILTER (WHERE result = 'DRAW')::int AS draws,
           COUNT(*) FILTER (WHERE result = 'NO_CONTEST')::int AS "noContests",
           COUNT(*) FILTER (WHERE "winnerId" = fighter_id
                              AND method::text IN ('KO', 'TKO'))::int AS "koWins"
    FROM sides
    GROUP BY fighter_id
  `;
}

/** Write derived records. See DeriveMode for what each mode may overwrite. */
export async function applyDerivedRecords(
  { apply, mode = "grow" }: { apply: boolean; mode?: DeriveMode },
): Promise<DeriveSummary> {
  const derived = await computeRecords();
  const summary: DeriveSummary = { scanned: derived.length, updated: 0, unchanged: 0, preserved: 0 };

  const existing = new Map(
    (await prisma.fighter.findMany({
      select: { id: true, wins: true, losses: true, draws: true, noContests: true, koWins: true },
    })).map((f) => [f.id, f]),
  );

  for (const d of derived) {
    const cur = existing.get(d.fighterId);
    if (!cur) continue;

    const storedBouts = cur.wins + cur.losses + cur.draws + cur.noContests;
    const derivedBouts = d.wins + d.losses + d.draws + d.noContests;
    const allowed =
      mode === "force" ? true :
      storedBouts === 0 ? true :                       // nothing to preserve
      mode === "grow" ? derivedBouts > storedBouts :   // we now know MORE than they published
      false;
    if (!allowed) { summary.preserved++; continue; }

    if (cur.wins === d.wins && cur.losses === d.losses && cur.draws === d.draws &&
        cur.noContests === d.noContests && cur.koWins === d.koWins) {
      summary.unchanged++;
      continue;
    }
    summary.updated++;
    if (apply) {
      await prisma.fighter.update({
        where: { id: d.fighterId },
        data: {
          wins: d.wins, losses: d.losses, draws: d.draws,
          noContests: d.noContests, koWins: d.koWins,
        },
      });
    }
  }
  return summary;
}
