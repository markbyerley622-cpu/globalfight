import "server-only";
import { prisma } from "@/lib/db";
import { publicDisplayName } from "@/lib/display-name";
import { pickStatus, picksLocked } from "@/lib/intelligence/pick-status";
import { groupResults, type GroupableRow } from "./grouping";
import type { CurrentPick, ResultGroup, PickCorner, FinishLabel, PickChallenge } from "./types";

// ════════════════════════════════════════════════════════════════════════════
//  The profile's READ queries.
//
//  ── The N+1 this exists to prevent ───────────────────────────────────────
//  Every field a pick card shows lives on a different table: the fight and its
//  fighters, the event and its promotion, the crowd split, the member's own
//  battle. Written naively that is four queries PER PICK, and a profile showing
//  twenty active picks becomes eighty round-trips on a page that is supposed to
//  load instantly.
//
//  Everything here is batched by fight id instead: the picks come back in one
//  read with their fight and event joined, and the crowd and challenges are two
//  more `IN (...)` reads for the whole page.
//
//  MEASURED, not assumed. Prisma expands a nested relation select into separate
//  statements, so this is nine queries rather than the three the code shape
//  suggests — but nine is the CONSTANT: 5, 10, 20 and 40 active picks all issue
//  exactly nine. A per-pick version would be around 120 at the top of that
//  range. The number that matters is the slope, and it is flat.
//
//  ── Why the shared predicates are imported, not reimplemented ────────────
//  `pickStatus` and `picksLocked` decide, in ONE place, when a bout counts as
//  open, awaiting a result, settled or void — and the profile must agree with
//  /predictions/mine and with the bout control exactly. A profile that invented
//  its own "is this still open?" test is how a settled pick starts showing a
//  live countdown.
// ════════════════════════════════════════════════════════════════════════════

/** The FightMethod values a pick can carry, as words. */
const FINISH_LABEL: Record<string, FinishLabel> = {
  KO: "KO/TKO", TKO: "KO/TKO", SUB: "Submission", SUBMISSION: "Submission",
  UD: "Decision", SD: "Decision", MD: "Decision", DECISION: "Decision",
};
const finishOf = (m: string | null): FinishLabel => (m ? FINISH_LABEL[m] ?? null : null);

const isCorner = (v: string): v is PickCorner => v === "RED" || v === "BLUE";

/** The join every pick read needs. Declared once so the two queries cannot drift. */
const PICK_INCLUDE = {
  fight: {
    select: {
      id: true, slug: true, date: true, result: true, cancelled: true,
      picksResolvedAt: true, winnerId: true, redId: true, blueId: true,
      red: { select: { name: true, slug: true } },
      blue: { select: { name: true, slug: true } },
      event: { select: { slug: true, name: true, promotion: true, date: true } },
    },
  },
} as const;

/**
 * ACTIVE picks — bouts that have not happened, newest fight FIRST.
 *
 * Ordered by the fight's date ascending because the useful question is "what is
 * this person calling next?", not "what did they click most recently". The
 * nearest fight is the one with a live countdown and the one a visitor can
 * still go and disagree with.
 *
 * `take: limit + 1` is how `moreCurrent` is answered without a second COUNT.
 */
export async function queryCurrentPicks(userId: string, limit: number): Promise<{ picks: CurrentPick[]; more: boolean }> {
  const rows = await prisma.fightPick.findMany({
    where: {
      userId,
      // Not yet fought. `date` on the fight rather than the event, because a
      // card can span midnight and the bout carries its own time.
      fight: { result: "SCHEDULED", cancelled: false, date: { gt: new Date() } },
    },
    orderBy: { fight: { date: "asc" } },
    take: limit + 1,
    select: { corner: true, method: true, ...PICK_INCLUDE },
  });

  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  if (page.length === 0) return { picks: [], more: false };

  const fightIds = page.map((r) => r.fight.id);

  // TWO batched reads for the whole page, whatever its size.
  const [crowdRows, battles] = await Promise.all([
    prisma.fightPick.groupBy({
      by: ["fightId", "corner"],
      where: { fightId: { in: fightIds } },
      _count: { corner: true },
    }),
    prisma.battle.findMany({
      where: { fightId: { in: fightIds }, OR: [{ challengerId: userId }, { opponentId: userId }] },
      select: {
        fightId: true, state: true, challengerId: true,
        challenger: { select: { name: true, username: true } },
        opponent: { select: { name: true, username: true } },
      },
    }),
  ]);

  const crowd = new Map<string, { RED: number; BLUE: number }>();
  for (const id of fightIds) crowd.set(id, { RED: 0, BLUE: 0 });
  for (const r of crowdRows) {
    const c = crowd.get(r.fightId);
    if (c && isCorner(r.corner)) c[r.corner] = r._count.corner;
  }

  const battleByFight = new Map<string, PickChallenge>();
  for (const b of battles) {
    // "Them" is whichever side of the battle is not the profile's owner.
    const them = b.challengerId === userId ? b.opponent : b.challenger;
    battleByFight.set(b.fightId, {
      state: b.state as PickChallenge["state"],
      opponentName: them ? publicDisplayName(them) : null,
      opponentUsername: them?.username ?? null,
    });
  }

  const picks = page.flatMap((r): CurrentPick[] => {
    if (!isCorner(r.corner)) return []; // a corrupt row must not crash a profile
    const f = r.fight;
    const c = crowd.get(f.id) ?? { RED: 0, BLUE: 0 };
    const total = c.RED + c.BLUE;
    return [{
      fightSlug: f.slug,
      eventSlug: f.event?.slug ?? null,
      eventName: f.event?.name ?? null,
      promotion: f.event?.promotion ?? null,
      date: f.date.toISOString(),
      redName: f.red.name,
      blueName: f.blue.name,
      redSlug: f.red.slug,
      blueSlug: f.blue.slug,
      corner: r.corner,
      pickedName: r.corner === "RED" ? f.red.name : f.blue.name,
      finish: finishOf(r.method),
      // The share of the room on THEIR side — the number a reader actually
      // wants ("67% agree with them"), not a red-corner percentage they then
      // have to invert in their head for a blue pick.
      crowdWithPct: total ? Math.round((c[r.corner] / total) * 100) : null,
      crowdTotal: total,
      picksClosed: picksLocked(f.event?.date ?? f.date),
      challenge: battleByFight.get(f.id) ?? null,
    }];
  });

  return { picks, more };
}

/**
 * SETTLED picks, newest first, grouped by event.
 *
 * `points` comes from the ReputationEvent ledger keyed by fight — the actual
 * credit, not a re-run of the scoring formula. Batched with one `IN (...)`.
 */
export async function queryRecentResults(userId: string, limit: number): Promise<{ groups: ResultGroup[]; more: boolean }> {
  const rows = await prisma.fightPick.findMany({
    where: { userId, fight: { result: { not: "SCHEDULED" } } },
    orderBy: { fight: { date: "desc" } },
    take: limit + 1,
    select: { corner: true, method: true, correct: true, ...PICK_INCLUDE },
  });

  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  if (page.length === 0) return { groups: [], more: false };

  const fightIds = page.map((r) => r.fight.id);
  const ledger = await prisma.reputationEvent.groupBy({
    by: ["refId"],
    where: { userId, refType: "fight", refId: { in: fightIds } },
    _sum: { delta: true },
  });
  const pointsByFight = new Map(ledger.flatMap((l) => (l.refId ? [[l.refId, l._sum.delta ?? 0]] : [])));

  // Mapped here, GROUPED in ./grouping — the grouping and tallying rules are
  // pure and unit-tested there rather than only observable against a database.
  const mapped: GroupableRow[] = [];

  for (const r of page) {
    if (!isCorner(r.corner)) continue;
    const f = r.fight;

    const winnerName =
      f.result !== "WIN" || !f.winnerId ? null
      : f.winnerId === f.redId || f.winnerId === f.red.slug ? f.red.name
      : f.winnerId === f.blueId || f.winnerId === f.blue.slug ? f.blue.name
      : null;

    mapped.push({
      fightSlug: f.slug,
      redName: f.red.name,
      blueName: f.blue.name,
      pickedName: r.corner === "RED" ? f.red.name : f.blue.name,
      winnerName,
      finish: finishOf(r.method),
      status: pickStatus({ correct: r.correct }, f),
      correct: r.correct,
      points: pointsByFight.get(f.id) ?? null,
      date: f.date.toISOString(),
      eventSlug: f.event?.slug ?? null,
      eventName: f.event?.name ?? null,
      promotion: f.event?.promotion ?? null,
      eventDate: (f.event?.date ?? f.date).toISOString(),
    });
  }

  return { groups: groupResults(mapped), more };
}
