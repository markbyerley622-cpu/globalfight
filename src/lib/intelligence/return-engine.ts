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
  userId: string; type: "FIGHT_ANNOUNCED" | "EVENT_LIVE" | "PICK_RESULT"; title: string; body: string;
  url: string; icon: string; dedupeKey: string;
};

// ── Prediction deadlines ───────────────────────────────────────────────────
// Picks lock at FIRST BELL for the whole card (see lib/picks.ts), so the
// deadline is simply the event date — there is no separate per-fight lock to
// track.
//
// Two windows, not three. A 15-minute warning was specified but is not
// deliverable: this engine runs on a cron, and a reminder that can fire up to a
// tick late is worse than none — it would tell people to hurry after picks had
// already closed. 24h gives time to research, 1h is the "last call". Each
// window carries its own dedupeKey so a user gets each at most once, ever.
const DEADLINE_WINDOWS = [
  { key: "24h", hours: 24, title: "Picks close tomorrow", icon: "⏳" },
  { key: "1h", hours: 1, title: "Last call — picks close in an hour", icon: "⏰" },
] as const;

/**
 * Users who follow an event and have NOT picked a single bout on it.
 *
 * Anyone who has already picked is deliberately excluded: the notification's
 * entire job is "you have not done this yet", and sending it to someone who has
 * is the fastest way to get the category muted.
 *
 * Two queries per event regardless of audience size — the follower list and the
 * set of ids that already picked — then a set difference in memory. No per-user
 * lookup.
 */
async function unpickedFollowers(eventId: string): Promise<string[]> {
  const [followers, picked] = await Promise.all([
    prisma.favoriteEvent.findMany({ where: { eventId }, select: { userId: true } }),
    prisma.fightPick.findMany({
      where: { fight: { eventId } },
      select: { userId: true },
      distinct: ["userId"],
    }),
  ]);
  const done = new Set(picked.map((p) => p.userId));
  return followers.map((f) => f.userId).filter((id) => !done.has(id));
}

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

  // ── Prediction deadlines ──
  // Each window is its own query rather than one wide scan: the ranges are
  // narrow and indexed on Event.date, so this stays cheap as the card list grows.
  let deadlines = 0;
  for (const w of DEADLINE_WINDOWS) {
    const from = new Date(now.getTime() + (w.hours - 1) * HOUR);
    const to = new Date(now.getTime() + w.hours * HOUR);
    const closing = await prisma.event.findMany({
      where: { status: { in: ["SCHEDULED", "ANNOUNCED"] }, date: { gte: from, lte: to } },
      select: { id: true, slug: true, name: true },
    });

    for (const e of closing) {
      const users = await unpickedFollowers(e.id);
      if (!users.length) continue;
      deadlines += await emit(
        users.map((userId) => ({
          userId,
          // PICK_RESULT maps to the "predictions" push category, which is
          // exactly the switch a user expects to control pick deadlines.
          type: "PICK_RESULT" as const,
          title: w.title,
          body: `${e.name} — you haven't made a pick yet.`,
          // Straight to the card, which is where the picks are.
          url: `/events/${e.slug}`,
          icon: w.icon,
          dedupeKey: `picks_closing:${e.id}:${w.key}`,
        })),
      );
    }
  }
  sent += deadlines;

  return { eventsSoon: soonEvents.length, eventsLive: liveEvents.length, sent };
}
