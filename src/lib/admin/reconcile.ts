import "server-only";
import { prisma } from "@/lib/db";
import { blockedByLock } from "@/lib/admin/provenance";
import { saveEvent, type EventPatch } from "@/lib/admin/events";
import { saveFight, type FightPatch } from "@/lib/admin/fights";

// ════════════════════════════════════════════════════════════════════════════
//  Importer reconciliation.
//
//  The importer and the editor have to cooperate, not take turns winning.
//  Locking already guarantees the operator wins — but silently, which means the
//  operator never finds out the source disagrees and the importer's work is
//  invisible. Recording the rejected value turns that into a decision:
//
//    Accept import   take the source's value and RELEASE the lock, so the field
//                    goes back to being maintained automatically
//    Keep manual     dismiss it; the operator's value stands
//
//  One row per (entity, field): only the latest proposal is worth reviewing, so
//  a re-run replaces rather than piles up.
// ════════════════════════════════════════════════════════════════════════════

const asText = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

/**
 * Record what an importer wanted but could not write. Best-effort by design —
 * ingest must never fail because a conflict could not be logged.
 */
export async function recordConflicts(
  entity: "Event" | "Fight",
  entityId: string,
  incoming: Record<string, unknown>,
  locked: readonly string[],
  current: Record<string, unknown>,
  source?: string,
): Promise<void> {
  const blocked = blockedByLock(incoming, locked);
  if (!blocked.length) return;
  try {
    for (const { field, importedValue } of blocked) {
      const imported = asText(importedValue);
      const mine = asText(current[field]);
      // The source agreeing with the operator is not a conflict.
      if (imported === mine) {
        await prisma.importConflict.deleteMany({ where: { entity, entityId, field } });
        continue;
      }
      await prisma.importConflict.upsert({
        where: { entity_entityId_field: { entity, entityId, field } },
        update: { importedValue: imported, currentValue: mine, source: source ?? null, resolvedAt: null, resolution: null },
        create: { entity, entityId, field, importedValue: imported, currentValue: mine, source: source ?? null },
      });
    }
  } catch {
    /* additive table not migrated yet — ingest must still complete */
  }
}

export interface ConflictRow {
  id: string; entity: string; entityId: string; field: string;
  currentValue: string | null; importedValue: string | null;
  source: string | null; createdAt: string;
  /** Label for a Fight conflict, so the operator knows WHICH bout. */
  subject?: string | null;
}

/** Open conflicts for an event and every bout on its card. */
export async function getEventConflicts(eventId: string): Promise<ConflictRow[]> {
  try {
    const fights = await prisma.fight.findMany({
      where: { eventId },
      select: { id: true, red: { select: { name: true } }, blue: { select: { name: true } } },
    });
    const nameById = new Map(fights.map((f) => [f.id, `${f.red.name} vs ${f.blue.name}`]));

    const rows = await prisma.importConflict.findMany({
      where: {
        resolvedAt: null,
        OR: [
          { entity: "Event", entityId: eventId },
          ...(fights.length ? [{ entity: "Fight", entityId: { in: fights.map((f) => f.id) } }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    return rows.map((r) => ({
      id: r.id, entity: r.entity, entityId: r.entityId, field: r.field,
      currentValue: r.currentValue, importedValue: r.importedValue,
      source: r.source, createdAt: r.createdAt.toISOString(),
      subject: r.entity === "Fight" ? nameById.get(r.entityId) ?? null : null,
    }));
  } catch {
    return [];
  }
}

/**
 * Resolve one conflict.
 *
 * "accept" goes through the NORMAL save path — validation, audit, the lot — and
 * then RELEASES the lock, because taking the source's value means handing the
 * field back to automation. Re-locking it would mean the next import raised the
 * identical conflict forever.
 */
export async function resolveConflict(
  actorId: string, conflictId: string, action: "accept" | "keep",
): Promise<{ ok: boolean; error?: string }> {
  const c = await prisma.importConflict.findUnique({ where: { id: conflictId } });
  if (!c) return { ok: false, error: "Conflict not found." };

  if (action === "keep") {
    await prisma.$transaction([
      prisma.importConflict.update({ where: { id: conflictId }, data: { resolvedAt: new Date(), resolution: "kept" } }),
      prisma.auditLog.create({
        data: { actorId, action: "import.keep", entity: c.entity, entityId: c.entityId, meta: { field: c.field, imported: c.importedValue } },
      }),
    ]);
    return { ok: true };
  }

  const value = coerce(c.field, c.importedValue);
  const result = c.entity === "Event"
    ? await saveEvent(actorId, c.entityId, { [c.field]: value } as EventPatch)
    : await saveFight(actorId, c.entityId, { [c.field]: value } as FightPatch);
  if (!result.ok) return { ok: false, error: result.issues?.[0]?.message ?? "Could not apply the imported value." };

  // Hand the field back to automation, or this exact conflict returns forever.
  const release = c.entity === "Event"
    ? prisma.event.update({ where: { id: c.entityId }, data: { lockedFields: { set: (await prisma.event.findUnique({ where: { id: c.entityId }, select: { lockedFields: true } }))!.lockedFields.filter((f) => f !== c.field) } } })
    : prisma.fight.update({ where: { id: c.entityId }, data: { lockedFields: { set: (await prisma.fight.findUnique({ where: { id: c.entityId }, select: { lockedFields: true } }))!.lockedFields.filter((f) => f !== c.field) } } });

  await prisma.$transaction([
    release,
    prisma.importConflict.update({ where: { id: conflictId }, data: { resolvedAt: new Date(), resolution: "accepted" } }),
    prisma.auditLog.create({
      data: { actorId, action: "import.accept", entity: c.entity, entityId: c.entityId, meta: { field: c.field, value: c.importedValue } },
    }),
  ]);
  return { ok: true };
}

/** Conflicts are stored as text; the save path expects real types. */
function coerce(field: string, raw: string | null): unknown {
  if (raw === null) return null;
  if (/(^scheduledRounds$|^roundEnded$|^orderOnCard$)/.test(field)) return Number(raw);
  if (/^(titleFight|interimTitle|mainEvent|coMain|cancelled|performanceBonus|fightOfTheNight)$/.test(field)) return raw === "true";
  return raw;
}

/** Accept or keep every open conflict on an event in one action. */
export async function resolveAll(actorId: string, eventId: string, action: "accept" | "keep"): Promise<{ resolved: number; failed: number }> {
  const open = await getEventConflicts(eventId);
  let resolved = 0, failed = 0;
  for (const c of open) {
    const r = await resolveConflict(actorId, c.id, action);
    if (r.ok) resolved++; else failed++;
  }
  return { resolved, failed };
}
