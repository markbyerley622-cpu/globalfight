import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { slugify } from "@/lib/utils";
import { invalidate } from "@/lib/cache";
import { lockableFightFields, withLocked } from "@/lib/admin/provenance";
import type { ValidationIssue } from "@/lib/admin/events";

// ════════════════════════════════════════════════════════════════════════════
//  Admin — fight mutations.
//
//  Mirrors lib/admin/events exactly: validate, lock, audit, all in ONE
//  transaction, one write path. The differences are structural, not stylistic:
//  a fight belongs to a card, so validation is CARD-wide (duplicate fighters,
//  two main events) and ordering is a set operation over siblings.
// ════════════════════════════════════════════════════════════════════════════

export const SEGMENTS = ["MAIN", "PRELIM", "EARLY_PRELIM"] as const;
export type Segment = (typeof SEGMENTS)[number];

const METHODS = new Set(["KO", "TKO", "UD", "SD", "MD", "SUB", "DQ", "RTD", "TD", "NC", "DRAW"]);
const RESULTS = new Set(["WIN", "LOSS", "DRAW", "NO_CONTEST", "SCHEDULED"]);

export interface FightPatch {
  redId?: string; blueId?: string;
  weightClassId?: string | null;
  scheduledRounds?: number;
  titleFight?: boolean; interimTitle?: boolean;
  mainEvent?: boolean; coMain?: boolean;
  cardSegment?: string | null;
  cancelled?: boolean; cardNote?: string | null;
  estimatedStartAt?: string | null;
  result?: string; winnerId?: string | null;
  method?: string | null; roundEnded?: number | null; timeEnded?: string | null;
  performanceBonus?: boolean; fightOfTheNight?: boolean;
}

/**
 * Validate against the whole CARD, not just the row.
 *
 * A fight is only valid in the context of its siblings: the same fighter twice
 * on one card, or two main events, are both card-level facts that a per-row
 * check cannot see.
 */
export async function validateFightPatch(fightId: string, patch: FightPatch): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const fight = await prisma.fight.findUnique({
    where: { id: fightId },
    select: { id: true, eventId: true, redId: true, blueId: true, result: true, scheduledRounds: true },
  });
  if (!fight) return [{ field: "id", message: "Fight not found." }];

  const redId = patch.redId ?? fight.redId;
  const blueId = patch.blueId ?? fight.blueId;
  if (redId === blueId) issues.push({ field: "blueId", message: "A fighter cannot face themselves." });

  if (patch.scheduledRounds !== undefined) {
    if (!Number.isInteger(patch.scheduledRounds) || patch.scheduledRounds < 1 || patch.scheduledRounds > 15) {
      issues.push({ field: "scheduledRounds", message: "Rounds must be a whole number from 1 to 15." });
    }
  }
  if (patch.cardSegment != null && patch.cardSegment !== "" && !SEGMENTS.includes(patch.cardSegment as Segment)) {
    issues.push({ field: "cardSegment", message: "Unknown broadcast segment." });
  }
  if (patch.result !== undefined && !RESULTS.has(patch.result)) {
    issues.push({ field: "result", message: "Unknown result." });
  }
  if (patch.method != null && patch.method !== "" && !METHODS.has(patch.method)) {
    issues.push({ field: "method", message: "Unknown method." });
  }

  const rounds = patch.scheduledRounds ?? fight.scheduledRounds;
  if (patch.roundEnded != null) {
    if (!Number.isInteger(patch.roundEnded) || patch.roundEnded < 1) {
      issues.push({ field: "roundEnded", message: "Finish round must be 1 or greater." });
    } else if (patch.roundEnded > rounds) {
      issues.push({ field: "roundEnded", message: `Finish round ${patch.roundEnded} is beyond the scheduled ${rounds}.` });
    }
  }
  if (patch.timeEnded != null && patch.timeEnded !== "" && !/^\d{1,2}:[0-5]\d$/.test(patch.timeEnded)) {
    issues.push({ field: "timeEnded", message: "Finish time must be m:ss, e.g. 4:21." });
  }

  // A decided fight needs a winner; a scheduled one must not have any result data.
  const result = patch.result ?? fight.result;
  if (result === "WIN") {
    const winner = patch.winnerId !== undefined ? patch.winnerId : undefined;
    if (winner !== undefined && winner !== null && winner !== redId && winner !== blueId) {
      issues.push({ field: "winnerId", message: "Winner must be one of the two fighters in this bout." });
    }
  }

  if (fight.eventId) {
    // Duplicate bout / duplicate fighter across the card.
    const siblings = await prisma.fight.findMany({
      where: { eventId: fight.eventId, id: { not: fightId }, cancelled: false },
      select: { id: true, redId: true, blueId: true, mainEvent: true, coMain: true },
    });
    for (const s of siblings) {
      if ((s.redId === redId && s.blueId === blueId) || (s.redId === blueId && s.blueId === redId)) {
        issues.push({ field: "redId", message: "This exact bout already exists on the card." });
        break;
      }
    }
    const clash = siblings.find((s) => s.redId === redId || s.blueId === redId || s.redId === blueId || s.blueId === blueId);
    if (clash && !issues.some((i) => i.field === "redId")) {
      issues.push({ field: "redId", message: "One of these fighters is already booked on this card." });
    }
    if (patch.mainEvent === true && siblings.some((s) => s.mainEvent)) {
      issues.push({ field: "mainEvent", message: "This card already has a main event." });
    }
    if (patch.coMain === true && siblings.some((s) => s.coMain)) {
      issues.push({ field: "coMain", message: "This card already has a co-main event." });
    }
  }

  return issues;
}

function toData(patch: FightPatch): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  const direct = [
    "redId", "blueId", "weightClassId", "scheduledRounds", "titleFight", "interimTitle",
    "mainEvent", "coMain", "cancelled", "winnerId", "roundEnded",
    "performanceBonus", "fightOfTheNight",
  ] as const;
  for (const k of direct) if (patch[k] !== undefined) d[k] = patch[k];
  for (const k of ["cardNote", "cardSegment", "method", "timeEnded"] as const) {
    if (patch[k] !== undefined) d[k] = patch[k] === "" ? null : patch[k];
  }
  if (patch.result !== undefined) d.result = patch.result;
  if (patch.estimatedStartAt !== undefined) {
    d.estimatedStartAt = patch.estimatedStartAt ? new Date(patch.estimatedStartAt) : null;
  }
  return d;
}

export interface FightSaveResult {
  ok: boolean;
  issues?: ValidationIssue[];
  fight?: { id: string; updatedAt: string; lockedFields: string[] };
  conflict?: { updatedAt: string };
}

/** Apply a fight patch. Same guarantees as saveEvent. */
export async function saveFight(
  actorId: string, fightId: string, patch: FightPatch, expectedUpdatedAt?: string,
): Promise<FightSaveResult> {
  const before = await prisma.fight.findUnique({ where: { id: fightId } });
  if (!before) return { ok: false, issues: [{ field: "id", message: "Fight not found." }] };
  if (expectedUpdatedAt && before.updatedAt.toISOString() !== expectedUpdatedAt) {
    return { ok: false, conflict: { updatedAt: before.updatedAt.toISOString() } };
  }

  const issues = await validateFightPatch(fightId, patch);
  if (issues.length) return { ok: false, issues };

  const current = before as unknown as Record<string, unknown>;
  const changed: Prisma.JsonArray = [];
  const finalData: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(toData(patch))) {
    const cur = current[k];
    const same = cur instanceof Date && v instanceof Date ? cur.getTime() === v.getTime() : cur === v;
    if (same) continue;
    finalData[k] = v;
    changed.push({
      field: k,
      from: (cur instanceof Date ? cur.toISOString() : cur) as Prisma.JsonValue,
      to: (v instanceof Date ? v.toISOString() : v) as Prisma.JsonValue,
    });
  }
  if (!changed.length) {
    return { ok: true, fight: { id: before.id, updatedAt: before.updatedAt.toISOString(), lockedFields: before.lockedFields } };
  }

  const locked = withLocked(before.lockedFields, lockableFightFields(changed.map((c) => (c as { field: string }).field)));
  const [updated] = await prisma.$transaction([
    prisma.fight.update({
      where: { id: fightId },
      data: { ...finalData, lockedFields: locked },
      select: { id: true, updatedAt: true, lockedFields: true, event: { select: { slug: true } } },
    }),
    prisma.auditLog.create({
      data: { actorId, action: "fight.update", entity: "Fight", entityId: before.eventId ?? fightId, meta: { fightId, changes: changed } },
    }),
  ]);

  if (updated.event) await invalidate(`event:${updated.event.slug}`);
  return { ok: true, fight: { id: updated.id, updatedAt: updated.updatedAt.toISOString(), lockedFields: updated.lockedFields } };
}

export interface OrderedFight { id: string; orderOnCard: number; cardSegment: Segment; mainEvent: boolean; coMain: boolean }

/**
 * Persist a whole reordering in one transaction.
 *
 * Ordering is a SET operation — moving one bout changes the index of every bout
 * after it — so this takes the full desired order rather than a single move.
 * Sending one request per affected row would leave the card briefly inconsistent
 * and produce a page of audit noise for a single drag.
 *
 * orderOnCard is locked on every row it touches, because ingest rebuilds that
 * column from the source's own index on every cron run.
 */
export async function reorderFights(
  actorId: string, eventId: string, order: { id: string; segment: Segment }[],
): Promise<{ ok: boolean; issues?: ValidationIssue[] }> {
  const existing = await prisma.fight.findMany({
    where: { eventId },
    select: { id: true, orderOnCard: true, cardSegment: true, mainEvent: true, coMain: true, lockedFields: true },
  });
  const byId = new Map(existing.map((f) => [f.id, f]));
  if (order.some((o) => !byId.has(o.id))) {
    return { ok: false, issues: [{ field: "order", message: "Reorder referenced a bout that is not on this card." }] };
  }
  if (order.length !== existing.length) {
    return { ok: false, issues: [{ field: "order", message: "Reorder must include every bout on the card." }] };
  }

  // Billing order is the array order. The top of MAIN is the main event and the
  // one below it is the co-main — derived, so an operator never hand-numbers
  // anything and the two badges cannot disagree with the running order.
  const mainSeq = order.filter((o) => o.segment === "MAIN");
  const writes = order.map((o, i) => {
    const prev = byId.get(o.id)!;
    const mainEvent = mainSeq[0]?.id === o.id;
    const coMain = mainSeq[1]?.id === o.id;
    return prisma.fight.update({
      where: { id: o.id },
      data: {
        orderOnCard: i,
        cardSegment: o.segment,
        mainEvent,
        coMain,
        lockedFields: withLocked(prev.lockedFields, ["orderOnCard", "cardSegment", "mainEvent", "coMain"]),
      },
    });
  });

  await prisma.$transaction([
    ...writes,
    prisma.auditLog.create({
      data: {
        actorId, action: "card.reorder", entity: "Fight", entityId: eventId,
        meta: { order: order.map((o, i) => ({ fightId: o.id, position: i, segment: o.segment })) } as Prisma.JsonObject,
      },
    }),
  ]);

  const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { slug: true } });
  if (ev) await invalidate(`event:${ev.slug}`);
  return { ok: true };
}

/** Add a bout to a card. Created at the BOTTOM of the earliest segment so it
 *  never silently displaces the main event. */
export async function createFight(
  actorId: string, eventId: string, input: { redId: string; blueId: string },
): Promise<{ ok: boolean; id?: string; issues?: ValidationIssue[] }> {
  if (input.redId === input.blueId) {
    return { ok: false, issues: [{ field: "blueId", message: "A fighter cannot face themselves." }] };
  }
  const ev = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, slug: true, name: true, date: true, sport: true, fights: { select: { orderOnCard: true } } },
  });
  if (!ev) return { ok: false, issues: [{ field: "eventId", message: "Event not found." }] };

  const [red, blue] = await Promise.all([
    prisma.fighter.findUnique({ where: { id: input.redId }, select: { name: true } }),
    prisma.fighter.findUnique({ where: { id: input.blueId }, select: { name: true } }),
  ]);
  if (!red || !blue) return { ok: false, issues: [{ field: "redId", message: "Fighter not found." }] };

  const base = slugify(`${ev.name}-${red.name}-vs-${blue.name}`);
  let slug = base;
  for (let i = 2; await prisma.fight.findUnique({ where: { slug }, select: { id: true } }); i++) slug = `${base}-${i}`;

  const nextOrder = Math.max(-1, ...ev.fights.map((f) => f.orderOnCard)) + 1;
  const fight = await prisma.fight.create({
    data: {
      slug, eventId, redId: input.redId, blueId: input.blueId, date: ev.date,
      orderOnCard: nextOrder, cardSegment: "EARLY_PRELIM",
      // Hand-added bouts are owned by their author from the start.
      lockedFields: ["redId", "blueId", "orderOnCard", "cardSegment"],
    },
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: { actorId, action: "fight.create", entity: "Fight", entityId: eventId, meta: { fightId: fight.id, red: red.name, blue: blue.name } },
  });
  await invalidate(`event:${ev.slug}`);
  return { ok: true, id: fight.id };
}

/**
 * Remove a bout from a card.
 *
 * Detaches rather than deletes when anyone has engaged with it: picks, battles
 * and a discussion room hang off a fight, and destroying those to tidy a card is
 * not a trade an operator should be able to make by accident. A bout nobody has
 * touched is deleted outright.
 */
export async function removeFight(actorId: string, fightId: string): Promise<{ ok: boolean; detached: boolean }> {
  const f = await prisma.fight.findUnique({
    where: { id: fightId },
    select: { id: true, eventId: true, event: { select: { slug: true } }, _count: { select: { picks: true, battles: true } } },
  });
  if (!f) return { ok: false, detached: false };

  const engaged = f._count.picks > 0 || f._count.battles > 0;
  if (engaged) {
    await prisma.$transaction([
      prisma.fight.update({ where: { id: fightId }, data: { cancelled: true, cardNote: "Removed from card.", lockedFields: { set: ["cancelled", "cardNote"] } } }),
      prisma.auditLog.create({ data: { actorId, action: "fight.cancel", entity: "Fight", entityId: f.eventId ?? fightId, meta: { fightId, reason: "has picks or battles" } } }),
    ]);
  } else {
    await prisma.$transaction([
      prisma.fight.delete({ where: { id: fightId } }),
      prisma.auditLog.create({ data: { actorId, action: "fight.delete", entity: "Fight", entityId: f.eventId ?? fightId, meta: { fightId } } }),
    ]);
  }
  if (f.event) await invalidate(`event:${f.event.slug}`);
  return { ok: true, detached: engaged };
}
