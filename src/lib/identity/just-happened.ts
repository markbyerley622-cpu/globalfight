import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { winnerCorner } from "@/lib/intelligence/scoring";
import { QUORUM } from "@/lib/identity/victory-headline";

// ── Just Happened — the identity-first post-fight surface ────────────────────
// A recently-completed card is NOT news here; it is EVIDENCE of what changed for
// the viewer. Each item answers, in order: who won · how · how hard the call was
// · what it did to YOUR record. The result and difficulty are public facts; the
// delta is the viewer's own graded picks. Clicking through goes to the existing
// event page (ResultReveal + Victory Cards) — this is the entry point, not a new
// recap destination.
//
// Reuse, no duplication: winnerCorner (pure), the QUORUM constant, the same
// reputation ledger the resolution engine writes. Four bounded queries total,
// independent of how many events or picks exist; cache()'d for the page.

export interface JustHappenedMain {
  /** The headline matchup, shown whether or not the result is in yet. */
  redName: string;
  blueName: string;
  titleFight: boolean;
  /** False when the bout happened but results aren't ingested — "Result pending". */
  resolved: boolean;
  // ── Resolved-only (null while pending) ──
  winnerName: string | null;
  loserName: string | null;
  method: string | null;
  roundEnded: number | null;
  /** Share of the crowd (0..100) that called the winner, or null below quorum. */
  calledByPct: number | null;
}

export interface JustHappenedViewer {
  graded: number;
  correct: number;
  repGained: number;
  /** True when the viewer called the main event's winner. */
  calledMain: boolean;
}

export interface JustHappenedEvent {
  slug: string;
  name: string;
  date: string;
  promotion: string | null;
  main: JustHappenedMain | null;
  /** The viewer's delta on this card — null when signed out or they didn't pick. */
  viewer: JustHappenedViewer | null;
}

const DEFAULT_DAYS = 12; // a result older than this is history, not "just happened"

/**
 * Recently-completed cards with their headline result, prediction difficulty and
 * — for a signed-in viewer — what the card did to their record.
 */
export const getJustHappened = cache(_getJustHappened);

async function _getJustHappened(
  viewerId: string | null,
  limit = 6,
  now: Date = new Date(),
): Promise<JustHappenedEvent[]> {
  const since = new Date(now.getTime() - DEFAULT_DAYS * 86_400_000);

  // 1 — cards that JUST HAPPENED (date in the window), whether or not results
  // are ingested yet. A boxing card whose results lag by a day must still appear
  // the morning after — it shows "Result pending" and fills in when the resolve
  // cron runs. Requiring a graded fight here is what made recent events vanish.
  const events = await prisma.event.findMany({
    where: {
      date: { gte: since, lt: now },
      status: { notIn: ["DRAFT", "CANCELLED", "POSTPONED"] },
    },
    orderBy: { date: "desc" },
    take: limit,
    select: {
      id: true, slug: true, name: true, date: true, promotion: true,
      fights: {
        // Headline bout: main event first, else the top of the card — regardless
        // of whether it's resolved, so a pending card still shows its matchup.
        orderBy: [{ mainEvent: "desc" }, { coMain: "desc" }, { orderOnCard: "asc" }],
        take: 1,
        select: {
          id: true, result: true, winnerId: true, redId: true, blueId: true,
          method: true, roundEnded: true, titleFight: true,
          red: { select: { name: true, slug: true } },
          blue: { select: { name: true, slug: true } },
        },
      },
    },
  });
  if (events.length === 0) return [];

  const eventIds = events.map((e) => e.id);
  const mainFightIds = events.map((e) => e.fights[0]?.id).filter(Boolean) as string[];

  // 2 — crowd split on each headline bout (difficulty).
  // 3 — the viewer's graded picks across these cards (their record delta).
  const [crowd, picks] = await Promise.all([
    mainFightIds.length
      ? prisma.fightPick.groupBy({ by: ["fightId", "corner"], where: { fightId: { in: mainFightIds } }, _count: { _all: true } })
      : Promise.resolve([] as { fightId: string; corner: string; _count: { _all: number } }[]),
    viewerId
      ? prisma.fightPick.findMany({
          where: { userId: viewerId, correct: { not: null }, fight: { eventId: { in: eventIds } } },
          select: { correct: true, corner: true, fightId: true, fight: { select: { eventId: true } } },
        })
      : Promise.resolve([] as { correct: boolean | null; corner: string; fightId: string; fight: { eventId: string | null } }[]),
  ]);

  // 4 — exact reputation the viewer earned on those cards (ledger, per fight).
  const correctFightIds = picks.filter((p) => p.correct).map((p) => p.fightId);
  const repByFight = new Map<string, number>();
  if (viewerId && correctFightIds.length) {
    const rep = await prisma.reputationEvent.groupBy({
      by: ["refId"],
      where: { userId: viewerId, refType: "fight", refId: { in: correctFightIds } },
      _sum: { delta: true },
    });
    for (const r of rep) if (r.refId) repByFight.set(r.refId, r._sum.delta ?? 0);
  }

  // Crowd tallies per headline bout → { total, byCorner }.
  const crowdByFight = new Map<string, { total: number; byCorner: Map<string, number> }>();
  for (const c of crowd) {
    let e = crowdByFight.get(c.fightId);
    if (!e) { e = { total: 0, byCorner: new Map() }; crowdByFight.set(c.fightId, e); }
    e.total += c._count._all;
    e.byCorner.set(c.corner, (e.byCorner.get(c.corner) ?? 0) + c._count._all);
  }

  // Viewer picks grouped by event.
  const viewerByEvent = new Map<string, { graded: number; correct: number; repGained: number; calledMainFightId?: string }>();
  for (const p of picks) {
    const eid = p.fight.eventId;
    if (!eid) continue;
    let v = viewerByEvent.get(eid);
    if (!v) { v = { graded: 0, correct: 0, repGained: 0 }; viewerByEvent.set(eid, v); }
    v.graded += 1;
    if (p.correct) { v.correct += 1; v.repGained += repByFight.get(p.fightId) ?? 0; }
  }
  // Which fight each viewer pick was on, to detect "called the main event".
  const pickCornerByFight = new Map<string, string>();
  for (const p of picks) pickCornerByFight.set(p.fightId, p.corner);

  return events.map((e): JustHappenedEvent => {
    const f = e.fights[0];
    let main: JustHappenedMain | null = null;
    if (f) {
      const corner = winnerCorner(f); // "RED" | "BLUE" | null (null while pending)
      const resolved = corner !== null;
      const c = crowdByFight.get(f.id);
      const onWinner = resolved ? c?.byCorner.get(corner) ?? 0 : 0;
      const calledByPct = resolved && c && c.total >= QUORUM ? Math.round((onWinner / c.total) * 100) : null;
      main = {
        redName: f.red.name,
        blueName: f.blue.name,
        titleFight: f.titleFight,
        resolved,
        winnerName: resolved ? (corner === "RED" ? f.red.name : f.blue.name) : null,
        loserName: resolved ? (corner === "RED" ? f.blue.name : f.red.name) : null,
        method: resolved ? f.method : null,
        roundEnded: resolved ? f.roundEnded : null,
        calledByPct,
      };
    }

    const vg = viewerByEvent.get(e.id);
    const viewer: JustHappenedViewer | null = vg
      ? {
          graded: vg.graded,
          correct: vg.correct,
          repGained: vg.repGained,
          calledMain: !!(f && main && pickCornerByFight.get(f.id) === (winnerCorner(f) ?? "")),
        }
      : null;

    return {
      slug: e.slug, name: e.name, date: e.date.toISOString(), promotion: e.promotion,
      main, viewer,
    };
  });
}
