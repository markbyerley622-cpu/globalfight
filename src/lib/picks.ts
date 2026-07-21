import "server-only";
import { prisma } from "@/lib/db";
import { track } from "@/lib/analytics";

// ── Crowd bout predictions ──────────────────────────────────────────────────
// The North Star mechanic: a signed-in user picks a corner (+ optional 1–5
// confidence) on a bout; the aggregate becomes the red-vs-blue crowd read. One
// pick per user per fight (upserted). Resolution/accuracy is a later pass — this
// is the write + aggregate half of the loop.

export type Corner = "RED" | "BLUE";
export interface CrowdRead {
  red: number;
  blue: number;
  total: number;
}
export interface MyPick {
  corner: Corner;
  confidence: number | null;
}

const isCorner = (v: unknown): v is Corner => v === "RED" || v === "BLUE";

async function fightIdBySlug(slug: string): Promise<string> {
  const f = await prisma.fight.findUnique({ where: { slug }, select: { id: true } });
  if (!f) throw new Error("Fight not found");
  return f.id;
}

/** Cast or change a pick. `confidence` is clamped to 1–5 when provided. */
export async function castPick(
  userId: string,
  fightSlug: string,
  corner: string,
  confidence?: number,
): Promise<{ crowd: CrowdRead; myPick: MyPick }> {
  if (!isCorner(corner)) throw new Error("Invalid corner");
  const f = await prisma.fight.findUnique({
    where: { slug: fightSlug },
    select: { id: true, result: true, event: { select: { date: true } } },
  });
  if (!f) throw new Error("Fight not found");
  if (f.result !== "SCHEDULED") throw new Error("This bout is already decided");
  // First-bell lock: once the card has started, picks close for the whole event.
  // Prevents picking a bout whose outcome is already known but not yet recorded
  // (results are entered in a batch after the event) — the integrity hole that a
  // seeded community would exploit on night one. Standard pick'em behaviour.
  if (f.event?.date && f.event.date.getTime() <= Date.now()) {
    throw new Error("Picks are locked — the card has started");
  }
  const fightId = f.id;
  const conf = confidence == null ? null : Math.max(1, Math.min(5, Math.round(confidence)));
  const existing = await prisma.fightPick.findUnique({
    where: { userId_fightId: { userId, fightId } },
    select: { corner: true },
  });
  await prisma.fightPick.upsert({
    where: { userId_fightId: { userId, fightId } },
    create: { userId, fightId, corner, confidence: conf },
    update: { corner, confidence: conf },
  });
  track(existing ? "prediction_changed" : "prediction_made", userId, { fight: fightSlug, corner });
  return { crowd: await crowdFor(fightId), myPick: { corner, confidence: conf } };
}

/** Remove a pick. */
export async function clearPick(userId: string, fightSlug: string): Promise<{ crowd: CrowdRead }> {
  const fightId = await fightIdBySlug(fightSlug);
  await prisma.fightPick.deleteMany({ where: { userId, fightId } });
  return { crowd: await crowdFor(fightId) };
}

async function crowdFor(fightId: string): Promise<CrowdRead> {
  const rows = await prisma.fightPick.groupBy({
    by: ["corner"],
    where: { fightId },
    _count: { corner: true },
  });
  const red = rows.find((r) => r.corner === "RED")?._count.corner ?? 0;
  const blue = rows.find((r) => r.corner === "BLUE")?._count.corner ?? 0;
  return { red, blue, total: red + blue };
}

/** The crowd read for one bout, by slug. */
export async function getCrowdForFight(fightSlug: string): Promise<CrowdRead> {
  return crowdFor(await fightIdBySlug(fightSlug));
}

/** The viewer's own pick on a bout, or null. */
export async function getMyPick(userId: string, fightSlug: string): Promise<MyPick | null> {
  const fightId = await fightIdBySlug(fightSlug);
  const row = await prisma.fightPick.findUnique({
    where: { userId_fightId: { userId, fightId } },
    select: { corner: true, confidence: true },
  });
  return row && isCorner(row.corner) ? { corner: row.corner, confidence: row.confidence } : null;
}

/** The viewer's picks across many fights at once (by fight id) — the batch
 *  counterpart to getMyPick, so a whole card renders without an N+1. */
export async function getMyPicksForFightIds(
  userId: string,
  fightIds: string[],
): Promise<Map<string, MyPick>> {
  const out = new Map<string, MyPick>();
  if (!fightIds.length) return out;
  const rows = await prisma.fightPick.findMany({
    where: { userId, fightId: { in: fightIds } },
    select: { fightId: true, corner: true, confidence: true },
  });
  for (const r of rows) {
    if (isCorner(r.corner)) out.set(r.fightId, { corner: r.corner, confidence: r.confidence });
  }
  return out;
}

/** Crowd reads for many fights at once (by fight id) — for cards/lists. */
export async function getCrowdForFightIds(fightIds: string[]): Promise<Map<string, CrowdRead>> {
  const out = new Map<string, CrowdRead>();
  if (!fightIds.length) return out;
  const rows = await prisma.fightPick.groupBy({
    by: ["fightId", "corner"],
    where: { fightId: { in: fightIds } },
    _count: { corner: true },
  });
  for (const id of fightIds) out.set(id, { red: 0, blue: 0, total: 0 });
  for (const r of rows) {
    const c = out.get(r.fightId)!;
    if (r.corner === "RED") c.red = r._count.corner;
    else if (r.corner === "BLUE") c.blue = r._count.corner;
    c.total = c.red + c.blue;
  }
  return out;
}
