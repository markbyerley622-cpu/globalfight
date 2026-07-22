import "server-only";
import { prisma } from "@/lib/db";

// ════════════════════════════════════════════════════════════════════════════
//  Presence — "who is here right now".
//
//  A check-in is a short-lived claim, never a location history. It carries an
//  explicit `expiresAt` and EVERY read filters on it, so presence decays on its
//  own without a sweeper job: an abandoned check-in simply stops matching.
//
//  Rows are kept after expiry only so a user can see their own history and so
//  a re-check-in extends rather than duplicates. Nothing public reads them.
// ════════════════════════════════════════════════════════════════════════════

/** How long a check-in counts as "here". Long enough for a session or a card,
 *  short enough that stale presence is never shown as live. */
export const CHECKIN_HOURS = { gym: 4, event: 8 } as const;

export interface PresenceUser {
  id: string;
  name: string | null;
  username: string | null;
  image: string | null;
  note: string | null;
  /** GymMember.role for a gym check-in — "3 coaches training" needs this. */
  role: string | null;
}

export interface PresenceSummary {
  /** Everyone currently checked in. */
  count: number;
  coaches: number;
  /** A capped sample for avatar stacks — never the whole room. */
  sample: PresenceUser[];
  /** Whether the VIEWER is currently checked in here. */
  viewerCheckedIn: boolean;
}

const EMPTY: PresenceSummary = { count: 0, coaches: 0, sample: [], viewerCheckedIn: false };

/** Check a user in. Re-checking in EXTENDS the existing window rather than
 *  stacking rows, so "37 people here" counts people, not taps. */
export async function checkIn(opts: {
  userId: string;
  gymId?: string;
  eventId?: string;
  note?: string | null;
}): Promise<{ expiresAt: Date }> {
  const { userId, gymId, eventId } = opts;
  if (!gymId && !eventId) throw new Error("checkIn needs a gym or an event");

  const hours = gymId ? CHECKIN_HOURS.gym : CHECKIN_HOURS.event;
  const expiresAt = new Date(Date.now() + hours * 3_600_000);
  const note = opts.note?.trim().slice(0, 80) || null;

  const existing = await prisma.checkIn.findFirst({
    where: { userId, gymId: gymId ?? null, eventId: eventId ?? null, expiresAt: { gt: new Date() } },
    select: { id: true },
  });

  if (existing) {
    await prisma.checkIn.update({ where: { id: existing.id }, data: { expiresAt, note } });
  } else {
    await prisma.checkIn.create({
      data: { userId, gymId: gymId ?? null, eventId: eventId ?? null, note, expiresAt },
    });
  }
  return { expiresAt };
}

/** Check out — expire immediately rather than delete, so the row still blocks
 *  a duplicate and the user's own history stays intact. */
export async function checkOut(opts: { userId: string; gymId?: string; eventId?: string }): Promise<void> {
  await prisma.checkIn.updateMany({
    where: {
      userId: opts.userId,
      gymId: opts.gymId ?? null,
      eventId: opts.eventId ?? null,
      expiresAt: { gt: new Date() },
    },
    data: { expiresAt: new Date() },
  });
}

const SAMPLE_SIZE = 8;

/** Live presence at one place. */
export async function getPresence(
  target: { gymId?: string; eventId?: string },
  viewerId?: string | null,
): Promise<PresenceSummary> {
  if (!target.gymId && !target.eventId) return EMPTY;
  const now = new Date();
  const where = {
    gymId: target.gymId ?? null,
    eventId: target.eventId ?? null,
    expiresAt: { gt: now },
  };

  const [count, sample] = await Promise.all([
    prisma.checkIn.count({ where }),
    prisma.checkIn.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: SAMPLE_SIZE,
      select: {
        note: true,
        user: { select: { id: true, name: true, username: true, image: true } },
      },
    }),
  ]);

  if (count === 0) return EMPTY;

  // Coach count is a gym concept — it comes from membership, not the check-in.
  let coachIds = new Set<string>();
  if (target.gymId) {
    const coaches = await prisma.gymMember.findMany({
      where: { gymId: target.gymId, role: { in: ["coach", "owner"] } },
      select: { userId: true },
    });
    coachIds = new Set(coaches.map((c) => c.userId));
  }

  const presentIds = sample.map((s) => s.user.id);
  const coachesPresent = target.gymId
    ? await prisma.checkIn.count({
        where: { ...where, userId: { in: [...coachIds] } },
      })
    : 0;

  return {
    count,
    coaches: coachesPresent,
    sample: sample.map((s) => ({
      id: s.user.id,
      name: s.user.name,
      username: s.user.username,
      image: s.user.image,
      note: s.note,
      role: coachIds.has(s.user.id) ? "coach" : null,
    })),
    viewerCheckedIn: viewerId ? presentIds.includes(viewerId) : false,
  };
}

/** Live counts for many places at once — one query for a whole map render. */
export async function getPresenceCounts(
  kind: "gym" | "event",
  ids: string[],
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.checkIn.groupBy({
    by: kind === "gym" ? ["gymId"] : ["eventId"],
    where:
      kind === "gym"
        ? { gymId: { in: ids }, expiresAt: { gt: new Date() } }
        : { eventId: { in: ids }, expiresAt: { gt: new Date() } },
    _count: { _all: true },
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    const id = kind === "gym" ? r.gymId : r.eventId;
    if (id) out.set(id, r._count._all);
  }
  return out;
}
