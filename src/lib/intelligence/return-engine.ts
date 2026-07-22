import "server-only";
import { prisma } from "@/lib/db";
import { pushToUsers } from "@/lib/push/send";
import { resolvePromotion } from "@/lib/promotions";

// ════════════════════════════════════════════════════════════════════════════
//  The Return Engine — the deterministic pipeline that brings people back.
//
//    event → audience (follows + pickers) → deduped notification → (open/return)
//
//  Two time-based triggers per event, each delivered at most once per user via
//  the Notification (userId, dedupeKey) unique + createMany(skipDuplicates):
//    • event_soon  — starts within ~30h: "tomorrow — 3 of your picks, 2 fighters
//                     you follow"
//    • event_live  — status LIVE: "LIVE NOW — join the discussion"
//
//  Pick RESULTS are already delivered by the resolution engine, so the loop's
//  "reward" step is covered; this closes the "announced" and "live" steps.
//  Idempotent — safe to run on any cadence.
// ════════════════════════════════════════════════════════════════════════════

const HOUR = 3_600_000;

interface AudienceMember { userId: string; picks: number; fighters: number }

/** Everyone who should hear about this event: promotion followers, followers of
 *  a fighter on the card, and anyone who already made a pick — merged, with the
 *  per-user signal used to personalise the copy. */
async function audienceFor(event: { id: string; promotion: string | null }): Promise<AudienceMember[]> {
  const fights = await prisma.fight.findMany({
    where: { eventId: event.id },
    select: { id: true, redId: true, blueId: true },
  });
  const fightIds = fights.map((f) => f.id);
  const fighterIds = [...new Set(fights.flatMap((f) => [f.redId, f.blueId]))];

  const promoSlug = event.promotion ? resolvePromotion(event.promotion).slug : null;

  const [promoFollowers, fighterFollowers, pickers] = await Promise.all([
    promoSlug
      ? prisma.favoritePromotion.findMany({ where: { promotion: promoSlug }, select: { userId: true } })
      : Promise.resolve([]),
    fighterIds.length
      ? prisma.favoriteFighter.findMany({ where: { fighterId: { in: fighterIds } }, select: { userId: true } })
      : Promise.resolve([]),
    fightIds.length
      ? prisma.fightPick.groupBy({ by: ["userId"], where: { fightId: { in: fightIds } }, _count: { userId: true } })
      : Promise.resolve([] as { userId: string; _count: { userId: number } }[]),
  ]);

  const map = new Map<string, AudienceMember>();
  const get = (id: string) => {
    let m = map.get(id);
    if (!m) { m = { userId: id, picks: 0, fighters: 0 }; map.set(id, m); }
    return m;
  };
  for (const r of promoFollowers) get(r.userId);
  for (const r of fighterFollowers) get(r.userId).fighters += 1;
  for (const r of pickers) get(r.userId).picks = r._count.userId;

  return [...map.values()];
}

type NewNotif = {
  userId: string; type: "FIGHT_ANNOUNCED" | "EVENT_LIVE"; title: string; body: string;
  url: string; icon: string; dedupeKey: string;
};

function soonBody(m: AudienceMember): string {
  const bits: string[] = [];
  if (m.picks) bits.push(`${m.picks} of your pick${m.picks === 1 ? "" : "s"}`);
  if (m.fighters) bits.push(`${m.fighters} fighter${m.fighters === 1 ? "" : "s"} you follow`);
  return bits.length ? bits.join(" · ") : "Make your picks before the first bell.";
}

async function emit(rows: NewNotif[]): Promise<number> {
  if (!rows.length) return 0;
  // The (userId, dedupeKey) unique means re-runs skip anyone already notified.
  const res = await prisma.notification.createMany({ data: rows, skipDuplicates: true });
  return res.count;
}

export async function runReturnEngine(): Promise<{ eventsSoon: number; eventsLive: number; sent: number }> {
  const now = new Date();
  const soonCutoff = new Date(now.getTime() + 30 * HOUR);

  const [soonEvents, liveEvents] = await Promise.all([
    prisma.event.findMany({
      where: { status: { in: ["SCHEDULED", "ANNOUNCED"] }, date: { gte: now, lte: soonCutoff } },
      select: { id: true, slug: true, name: true, promotion: true },
    }),
    prisma.event.findMany({
      where: { status: "LIVE" },
      select: { id: true, slug: true, name: true, promotion: true },
    }),
  ]);

  let sent = 0;

  for (const e of soonEvents) {
    const audience = await audienceFor(e);
    sent += await emit(audience.map((m) => ({
      userId: m.userId,
      type: "FIGHT_ANNOUNCED",
      title: `${e.name} is almost here`,
      body: soonBody(m),
      url: `/events/${e.slug}`,
      icon: "🔔",
      dedupeKey: `event_soon:${e.id}`,
    })));
  }

  for (const e of liveEvents) {
    const audience = await audienceFor(e);
    sent += await emit(audience.map((m) => ({
      userId: m.userId,
      type: "EVENT_LIVE",
      title: `${e.name} is LIVE`,
      body: "Picks are locked — jump into the live discussion.",
      url: `/events/${e.slug}`,
      icon: "🔴",
      dedupeKey: `event_live:${e.id}`,
    })));
  }

  return { eventsSoon: soonEvents.length, eventsLive: liveEvents.length, sent };
}
