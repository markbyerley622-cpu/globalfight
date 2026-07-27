import "server-only";
import type { NotificationType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { pushToUsers } from "@/lib/push/send";
import { CATEGORY_OF, type NotifCategory } from "@/lib/push/policy";
import { filterByPreference } from "@/lib/follow-targets";
import { resolvePromotion } from "@/lib/promotions";
import { dayKey, STREAK_WARN_MIN } from "@/lib/identity/streak-math";

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

/** Everyone who should hear about this event: the EVENT's own followers, the
 *  promotion's, followers of a fighter on the card, and anyone who already made a
 *  pick — merged, with the per-user signal used to personalise the copy. */
async function audienceFor(event: { id: string; promotion: string | null }): Promise<AudienceMember[]> {
  const fights = await prisma.fight.findMany({
    where: { eventId: event.id },
    select: { id: true, redId: true, blueId: true },
  });
  const fightIds = fights.map((f) => f.id);
  const fighterIds = [...new Set(fights.flatMap((f) => [f.redId, f.blueId]))];

  const promoSlug = event.promotion ? resolvePromotion(event.promotion).slug : null;

  const [eventFollowers, promoFollowers, fighterFollowers, pickers] = await Promise.all([
    // The EVENT's own followers were missing entirely. Tapping "Remind me" on a card
    // is the most explicit request for exactly these two notifications in the app,
    // and it was the one audience that did not receive them — unless the user also
    // happened to follow the promotion or a fighter on it.
    prisma.favoriteEvent.findMany({ where: { eventId: event.id }, select: { userId: true } }),
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
  for (const r of eventFollowers) get(r.userId);
  for (const r of promoFollowers) get(r.userId);
  for (const r of fighterFollowers) get(r.userId).fighters += 1;
  for (const r of pickers) get(r.userId).picks = r._count.userId;

  return [...map.values()];
}

type NewNotif = {
  // The enum itself, not a hand-listed subset: a new producer here should not
  // have to widen a union that exists a hundred lines away.
  userId: string; type: NotificationType; title: string; body: string;
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
  { key: "24h", hours: 24, title: "Picks close tomorrow", icon: "scheduled" },
  { key: "1h", hours: 1, title: "Last call — picks close in an hour", icon: "scheduled" },
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

/**
 * Drop rows whose recipient muted that notification's category.
 *
 * This engine wrote its in-app rows unconditionally and gated only the PUSH, so a
 * user who turned "Fights & events" off still accumulated every reminder in their
 * bell — the toggle hid the buzz and not the notification. Everywhere else in the
 * app a disabled category GENERATES NOTHING (see followerIdsToNotify), and the
 * scheduler was the one path that disagreed.
 *
 * Batched by category — one query per distinct category in the batch, never one
 * per row, and typically exactly one.
 */
async function allowedByPreference(rows: NewNotif[]): Promise<NewNotif[]> {
  const byCategory = new Map<NotifCategory, Set<string>>();
  for (const r of rows) {
    const category = CATEGORY_OF[r.type] ?? "social";
    const set = byCategory.get(category) ?? new Set<string>();
    set.add(r.userId);
    byCategory.set(category, set);
  }

  const allowed = new Map<NotifCategory, Set<string>>();
  await Promise.all(
    [...byCategory].map(async ([category, userIds]) => {
      allowed.set(category, new Set(await filterByPreference([...userIds], category)));
    }),
  );

  return rows.filter((r) => allowed.get(CATEGORY_OF[r.type] ?? "social")?.has(r.userId));
}

async function emit(all: NewNotif[]): Promise<number> {
  if (!all.length) return 0;
  const rows = await allowedByPreference(all);
  if (!rows.length) return 0;
  const keys = [...new Set(rows.map((r) => r.dedupeKey))];

  // Who already had these before we wrote? Anyone in this set is a duplicate
  // the insert will skip, and must NOT be pushed again.
  const before = await prisma.notification.findMany({
    where: { dedupeKey: { in: keys } },
    select: { userId: true, dedupeKey: true },
  });

  // The (userId, dedupeKey) unique means re-runs skip anyone already notified.
  const res = await prisma.notification.createMany({ data: rows, skipDuplicates: true });
  if (res.count > 0) {
    await pushCreated(keys, new Set(before.map((b) => `${b.userId}|${b.dedupeKey}`)));
  }
  return res.count;
}

/**
 * Push the rows this call actually created.
 *
 * The engine wrote its notifications and pushed NONE of them — every scheduled
 * reminder was in-app only, which is the exact gap web push was added to close:
 * a fight reminder that requires you to already be in the app is not a reminder.
 *
 * createMany returns a count, not the rows, so the created set is recovered by
 * diffing the (userId, dedupeKey) pairs that existed BEFORE the insert against
 * the ones that exist after. Deliberately NOT "createdAt ≥ now": the app server
 * and the database are different hosts with different clocks, and if the DB's
 * ran even slightly behind, every row would fall outside the window and the
 * whole feature would go quiet with nothing in the logs to say so. The diff
 * asks the database what it actually has and involves no clock at all.
 */
async function pushCreated(keys: string[], alreadyHad: Set<string>): Promise<void> {
  const created = (
    await prisma.notification.findMany({
      where: { dedupeKey: { in: keys } },
      select: { userId: true, type: true, title: true, body: true, url: true, icon: true, dedupeKey: true },
    })
  ).filter((n) => !alreadyHad.has(`${n.userId}|${n.dedupeKey}`));

  // Bodies are personalised ("3 of your picks"), so group by the payload rather
  // than by the key — one send per distinct message, not one per user.
  const groups = new Map<string, { userIds: string[]; row: (typeof created)[number] }>();
  for (const c of created) {
    const sig = `${c.type}|${c.title}|${c.body ?? ""}|${c.url ?? ""}`;
    const g = groups.get(sig);
    if (g) g.userIds.push(c.userId);
    else groups.set(sig, { userIds: [c.userId], row: c });
  }

  await Promise.all(
    [...groups.values()].map(({ userIds, row }) =>
      pushToUsers(userIds, row.type, {
        title: row.title,
        body: row.body,
        url: row.url,
        icon: row.icon,
        // One event = one lit phone, however many triggers it fires.
        tag: row.dedupeKey?.split(":").slice(0, 2).join(":"),
      }).catch(() => ({ sent: 0, skipped: 0 })),
    ),
  );
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
      icon: "bell",
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
      icon: "live",
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

  sent += await emitFighterBookings(now);
  sent += await emitRankMilestones();
  sent += await emitDormantNudge(now);
  sent += await emitStreakWarnings(now);

  return { eventsSoon: soonEvents.length, eventsLive: liveEvents.length, sent };
}

// ── The streak-keeper: the ONE reminder that needs no fight ──────────────────

// Warn only in the back half of the UTC day. The streak breaks at the next UTC
// midnight, so firing at 02:00 UTC (they have all day to return on their own) is
// premature and reads as nagging; firing in the evening catches the people who
// genuinely aren't coming back today. The per-day dedupeKey keeps it to one
// reminder even though the cron runs every hour in this window.
const STREAK_WARN_FROM_UTC_HOUR = 17;
// Bound one run. Ordered by streak desc so the biggest (most painful to lose,
// and the users we most want to save) are never the ones dropped if capped.
const STREAK_WARN_LIMIT = 5000;

/**
 * "Keep your 42-day streak alive."
 *
 * The only Return-Engine trigger that fires on a day with no fights — the answer
 * to "why open the app on a Tuesday". Targets streaks that are ALIVE (visited
 * yesterday) but NOT yet extended today, worth protecting (≥ STREAK_WARN_MIN).
 *
 * The at-risk set is a single indexed range on lastActiveOn: rows whose last
 * active day is exactly yesterday. `dayStreak >= MIN` filters in memory (the
 * range already narrows to one day of actives). No per-user lookup; quiet hours
 * and the predictions toggle gate the PUSH inside pushToUsers, exactly as every
 * other producer here relies on.
 */
async function emitStreakWarnings(now: Date): Promise<number> {
  if (now.getUTCHours() < STREAK_WARN_FROM_UTC_HOUR) return 0;

  const today = dayKey(now);
  const yesterday = new Date(today.getTime() - 86_400_000);

  // lastActiveOn is stored as a UTC-midnight value, so "== yesterday" is the
  // half-open range [yesterday, today). That is precisely streakWarningDue's
  // gap === 1 case; encoding it as a range lets the index do the work.
  const atRisk = await prisma.user.findMany({
    where: {
      dayStreak: { gte: STREAK_WARN_MIN },
      lastActiveOn: { gte: yesterday, lt: today },
    },
    select: { id: true, dayStreak: true },
    orderBy: { dayStreak: "desc" },
    take: STREAK_WARN_LIMIT,
  });
  if (!atRisk.length) return 0;

  const dayTag = today.toISOString().slice(0, 10); // one reminder per user per day
  return emit(
    atRisk.map((u) => ({
      userId: u.id,
      type: "STREAK_REMINDER",
      title: `Keep your ${u.dayStreak}-day streak`,
      // No wall-clock: the deadline is UTC midnight, an odd local time for many,
      // so the copy stays true in every zone.
      body: `You haven't opened Combat Reviews today — drop in to keep your ${u.dayStreak}-day streak alive.`,
      url: "/today",
      icon: "streak",
      dedupeKey: `streak_warn:${dayTag}`,
    })),
  );
}

// ── Following: a fighter you follow got booked ──────────────────────────────

/**
 * "Tom Aspinall has a fight booked."
 *
 * Following a fighter has so far only fed the Following feed and the event_soon
 * copy — the moment a follow actually pays off, the booking, went unannounced.
 *
 * Bookings are detected by scanning fights CREATED recently rather than by
 * tracking a cursor: the (userId, dedupeKey) unique makes a re-scan free, so
 * the engine needs no watermark to be exactly-once. A 48h window comfortably
 * covers an hourly cron plus a long outage.
 */
async function emitFighterBookings(now: Date): Promise<number> {
  const fights = await prisma.fight.findMany({
    where: {
      createdAt: { gte: new Date(now.getTime() - 48 * HOUR) },
      event: { date: { gte: now } }, // a booking is only news while it is ahead of you
    },
    select: {
      id: true, redId: true, blueId: true,
      red: { select: { name: true } },
      blue: { select: { name: true } },
      event: { select: { slug: true, name: true } },
    },
    take: 500,
  });
  if (!fights.length) return 0;

  const fighterIds = [...new Set(fights.flatMap((f) => [f.redId, f.blueId]))];
  const follows = await prisma.favoriteFighter.findMany({
    where: { fighterId: { in: fighterIds } },
    select: { userId: true, fighterId: true },
  });
  if (!follows.length) return 0;

  const byFighter = new Map<string, string[]>();
  for (const f of follows) {
    const list = byFighter.get(f.fighterId);
    if (list) list.push(f.userId);
    else byFighter.set(f.fighterId, [f.userId]);
  }

  const rows: NewNotif[] = [];
  for (const f of fights) {
    if (!f.event) continue;
    for (const [fighterId, name, opponent] of [
      [f.redId, f.red?.name, f.blue?.name],
      [f.blueId, f.blue?.name, f.red?.name],
    ] as const) {
      if (!name) continue;
      for (const userId of byFighter.get(fighterId) ?? []) {
        rows.push({
          userId,
          type: "FIGHT_ANNOUNCED",
          title: `${name} is booked`,
          body: opponent ? `vs ${opponent} · ${f.event.name}` : f.event.name,
          url: `/events/${f.event.slug}`,
          icon: "fight",
          // Per fighter, not per fight: someone following BOTH corners of the
          // same bout is told once about each, never twice about the bout.
          dedupeKey: `booked:${f.id}:${fighterId}`,
        });
      }
    }
  }
  return emit(rows);
}

// ── Leaderboard: entering the top N ─────────────────────────────────────────

const RANK_TIERS = [
  { n: 1, title: "You're #1", body: "Top of the board. Everyone else is chasing you now." },
  { n: 3, title: "Top 3 on the board", body: "You're in the podium places." },
  { n: 10, title: "Top 10 on the board", body: "Your calls put you in the top ten." },
  { n: 50, title: "Top 50 on the board", body: "You've broken into the top fifty." },
  { n: 100, title: "Top 100 on the board", body: "You've broken into the top hundred." },
] as const;

/**
 * Announce ENTERING a tier — never leaving one.
 *
 * "You dropped to #12" is a notification that punishes people for opening the
 * app, so the engine does not send it. The upside is the whole point.
 *
 * Keyed rank_top:<n>, once per account: no rank snapshot to store, and no
 * see-sawing around a boundary buzzing someone every hour. Reading the top 100
 * is one indexed query regardless of how many users exist.
 */
async function emitRankMilestones(): Promise<number> {
  const top = await prisma.user.findMany({
    where: { picksResolved: { gt: 0 }, reputation: { gt: 0 } },
    orderBy: [{ reputation: "desc" }, { bestPickStreak: "desc" }],
    take: RANK_TIERS[RANK_TIERS.length - 1].n,
    select: { id: true },
  });

  const rows: NewNotif[] = top.map((u, i) => {
    const rank = i + 1;
    const tier = RANK_TIERS.find((t) => rank <= t.n)!; // the tightest tier reached
    return {
      userId: u.id,
      type: "REP_MILESTONE" as const,
      title: tier.title,
      body: tier.body,
      url: "/leaderboard",
      icon: "milestone",
      dedupeKey: `rank_top:${tier.n}`,
    };
  });
  return emit(rows);
}

// ── The dormant nudge ───────────────────────────────────────────────────────

/**
 * The one digest worth sending.
 *
 * A true daily digest is a notification you get for existing, and the fastest
 * way to have a whole category muted — so this is not that. It fires only when
 * all three are true: the person has been away a while, a card they follow is
 * close, and they have not picked it. That is a real, actionable gap, and once
 * they pick it the reason to send disappears.
 *
 * Anyone active recently is skipped entirely: they have already seen the
 * deadline reminders and do not need the same news summarised back at them.
 * Quiet hours and the "predictions" category toggle still gate the push.
 */
async function emitDormantNudge(now: Date): Promise<number> {
  const soon = new Date(now.getTime() + 7 * 24 * HOUR);
  const events = await prisma.event.findMany({
    where: { status: { in: ["SCHEDULED", "ANNOUNCED"] }, date: { gte: now, lte: soon } },
    select: { id: true, slug: true, name: true, date: true },
    orderBy: { date: "asc" },
    take: 40,
  });
  if (!events.length) return 0;

  // Candidates: followers of those cards who have not picked them.
  const candidates = new Map<string, (typeof events)[number]>();
  for (const e of events) {
    for (const userId of await unpickedFollowers(e.id)) {
      // Their SOONEST unpicked card is the one worth naming.
      if (!candidates.has(userId)) candidates.set(userId, e);
    }
  }
  if (!candidates.size) return 0;

  // Drop anyone who has used the app in the last 5 days. Derived from the
  // analytics pageviews already being written — a lastSeenAt column would be a
  // second, drift-prone copy of a fact the app already records.
  const active = await prisma.analyticsEvent.findMany({
    where: { userId: { in: [...candidates.keys()] }, ts: { gte: new Date(now.getTime() - 5 * 24 * HOUR) } },
    select: { userId: true },
    distinct: ["userId"],
  });
  for (const a of active) if (a.userId) candidates.delete(a.userId);
  if (!candidates.size) return 0;

  const rows: NewNotif[] = [...candidates.entries()].map(([userId, e]) => ({
    userId,
    type: "PICK_RESULT" as const, // the "predictions" push category
    title: "You've got picks waiting",
    body: `${e.name} is coming up and you haven't called it yet.`,
    url: `/events/${e.slug}`,
    icon: "welcome",
    // Per card, not per day: they are nudged about a given event once, ever.
    dedupeKey: `nudge:${e.id}`,
  }));
  return emit(rows);
}
