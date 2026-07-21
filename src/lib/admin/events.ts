import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { slugify } from "@/lib/utils";
import { invalidate } from "@/lib/cache";
import {
  lockableEventFields, withLocked, LOCKABLE_EVENT_FIELDS,
} from "@/lib/admin/provenance";

// ════════════════════════════════════════════════════════════════════════════
//  Admin — event mutations.
//
//  Every write goes through here so three things are guaranteed together and
//  cannot drift apart:
//    1. validation runs BEFORE the row is touched
//    2. edited fields are locked against the ingest pipeline
//    3. an AuditLog row records who changed what, from what, to what
//
//  There is no second path. The route handler is a thin shell around this.
// ════════════════════════════════════════════════════════════════════════════

export interface EventPatch {
  name?: string;
  slug?: string;
  promotion?: string | null;
  sport?: string;
  status?: string;
  venue?: string | null;
  city?: string | null;
  country?: string | null;
  countryCode?: string | null;
  broadcaster?: string | null;
  posterUrl?: string | null;
  heroUrl?: string | null;
  description?: string | null;
  timezone?: string | null;
  eventUrl?: string | null;
  ticketUrl?: string | null;
  date?: string;
  broadcastStartAt?: string | null;
  prelimStartAt?: string | null;
  mainCardStartAt?: string | null;
}

export type ValidationIssue = { field: string; message: string };

const STATUSES = new Set(["DRAFT", "ANNOUNCED", "SCHEDULED", "LIVE", "COMPLETED", "CANCELLED", "POSTPONED"]);
const SPORTS = new Set([
  "BOXING", "MMA", "MUAY_THAI", "KICKBOXING", "K1", "BARE_KNUCKLE", "BJJ", "BJJ_NOGI",
  "WRESTLING", "JUDO", "TAEKWONDO", "SAMBO", "COMBAT_SAMBO",
]);

const isUrl = (v: string): boolean => {
  try { const u = new URL(v); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; }
};
const isDate = (v: string): boolean => !Number.isNaN(Date.parse(v));

/**
 * Validate a patch against the row it will be applied to.
 *
 * Returns EVERY problem, not just the first — an operator fixing a form one
 * error at a time is how a CMS earns its reputation.
 */
export async function validateEventPatch(eventId: string, patch: EventPatch): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  if (patch.name !== undefined && patch.name.trim().length < 3) {
    issues.push({ field: "name", message: "Title needs at least 3 characters." });
  }
  if (patch.slug !== undefined) {
    const s = patch.slug.trim();
    if (slugify(s) !== s || !s) {
      issues.push({ field: "slug", message: "Slug must be lower-case words separated by single hyphens." });
    } else {
      const clash = await prisma.event.findFirst({ where: { slug: s, id: { not: eventId } }, select: { id: true } });
      if (clash) issues.push({ field: "slug", message: "Another event already uses this slug." });
    }
  }
  if (patch.sport !== undefined && !SPORTS.has(patch.sport)) {
    issues.push({ field: "sport", message: "Unknown sport." });
  }
  if (patch.status !== undefined && !STATUSES.has(patch.status)) {
    issues.push({ field: "status", message: "Unknown status." });
  }
  if (patch.date !== undefined && !isDate(patch.date)) {
    issues.push({ field: "date", message: "Event date is not a valid date." });
  }

  // Block starts must be same-day-ish and ordered. An operator who types 21:00
  // for the prelims and 19:00 for the main card has made a real mistake.
  const starts: [keyof EventPatch, string][] = [
    ["broadcastStartAt", "Broadcast start"],
    ["prelimStartAt", "Prelim start"],
    ["mainCardStartAt", "Main card start"],
  ];
  for (const [field, label] of starts) {
    const v = patch[field] as string | null | undefined;
    if (v != null && v !== "" && !isDate(v)) issues.push({ field, message: `${label} is not a valid time.` });
  }
  const t = (v: unknown) => (typeof v === "string" && isDate(v) ? Date.parse(v) : null);
  const bc = t(patch.broadcastStartAt), pr = t(patch.prelimStartAt), mc = t(patch.mainCardStartAt);
  if (bc != null && pr != null && bc > pr) issues.push({ field: "broadcastStartAt", message: "Broadcast start is after the prelims." });
  if (pr != null && mc != null && pr > mc) issues.push({ field: "prelimStartAt", message: "Prelims start after the main card." });

  for (const [field, label] of [["eventUrl", "Event URL"], ["ticketUrl", "Ticket URL"]] as const) {
    const v = patch[field];
    if (v != null && v !== "" && !isUrl(v)) issues.push({ field, message: `${label} must be a full http(s) URL.` });
  }

  // Publishing gate: a card the public can see must have a main event.
  if (patch.status !== undefined && patch.status !== "DRAFT" && patch.status !== "CANCELLED") {
    const mains = await prisma.fight.count({ where: { eventId, mainEvent: true, cancelled: false } });
    if (mains === 0) issues.push({ field: "status", message: "Cannot publish without a main event on the card." });
    if (mains > 1) issues.push({ field: "status", message: `Card has ${mains} main events — exactly one is allowed.` });
  }

  return issues;
}

const asDate = (v: string | null | undefined): Date | null | undefined =>
  v === undefined ? undefined : v === null || v === "" ? null : new Date(v);

/** Translate a validated patch into Prisma data. */
function toData(patch: EventPatch): Prisma.EventUpdateInput {
  const d: Record<string, unknown> = {};
  const copy = [
    "name", "slug", "promotion", "venue", "city", "country", "countryCode", "broadcaster",
    "posterUrl", "heroUrl", "description", "timezone", "eventUrl", "ticketUrl",
  ] as const;
  for (const k of copy) {
    if (patch[k] !== undefined) d[k] = typeof patch[k] === "string" ? (patch[k] as string).trim() || null : patch[k];
  }
  if (patch.sport !== undefined) d.sport = patch.sport;
  if (patch.status !== undefined) d.status = patch.status;
  if (patch.date !== undefined) d.date = new Date(patch.date);
  for (const k of ["broadcastStartAt", "prelimStartAt", "mainCardStartAt"] as const) {
    const v = asDate(patch[k]);
    if (v !== undefined) d[k] = v;
  }
  return d as Prisma.EventUpdateInput;
}

export interface SaveResult {
  ok: boolean;
  issues?: ValidationIssue[];
  /** Present on success — the row as it now stands, plus its lock state. */
  event?: { id: string; slug: string; updatedAt: string; lockedFields: string[] };
  /** Set when the caller's baseline was stale. */
  conflict?: { updatedAt: string };
}

/**
 * Apply an event patch.
 *
 * `expectedUpdatedAt` is optimistic concurrency: two operators on the same card
 * is normal on fight week, and last-write-wins would silently discard the other
 * one's work. A stale baseline returns a conflict instead of overwriting.
 *
 * Everything happens in ONE transaction — row, lock set and audit entries commit
 * together, so there is no state where a change exists without its audit trail.
 */
export async function saveEvent(
  actorId: string,
  eventId: string,
  patch: EventPatch,
  expectedUpdatedAt?: string,
): Promise<SaveResult> {
  const before = await prisma.event.findUnique({ where: { id: eventId } });
  if (!before) return { ok: false, issues: [{ field: "id", message: "Event not found." }] };

  if (expectedUpdatedAt && before.updatedAt.toISOString() !== expectedUpdatedAt) {
    return { ok: false, conflict: { updatedAt: before.updatedAt.toISOString() } };
  }

  const issues = await validateEventPatch(eventId, patch);
  if (issues.length) return { ok: false, issues };

  const data = toData(patch);
  // Only fields that actually CHANGED are written or audited. An autosave that
  // resends an untouched form must not produce a page of "changed X from Y to Y".
  const current = before as unknown as Record<string, unknown>;
  // Prisma.InputJsonValue, so the audit payload is storable without a cast at
  // the call site. Dates are serialised to ISO on the way in.
  const changed: Prisma.JsonArray = [];
  const finalData: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
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
    return { ok: true, event: { id: before.id, slug: before.slug, updatedAt: before.updatedAt.toISOString(), lockedFields: before.lockedFields } };
  }

  const locked = withLocked(
    before.lockedFields,
    lockableEventFields(changed.map((c) => (c as { field: string }).field)),
  );

  const [updated] = await prisma.$transaction([
    prisma.event.update({
      where: { id: eventId },
      data: { ...finalData, lockedFields: locked },
      select: { id: true, slug: true, updatedAt: true, lockedFields: true },
    }),
    prisma.auditLog.create({
      data: {
        actorId,
        action: "event.update",
        entity: "Event",
        entityId: eventId,
        meta: { changes: changed },
      },
    }),
  ]);

  // Discovery, the event page and the sitemap all read cached repo helpers.
  await invalidate("events:upcoming");
  await invalidate("events:results");
  await invalidate(`event:${updated.slug}`);
  if (before.slug !== updated.slug) await invalidate(`event:${before.slug}`);

  return {
    ok: true,
    event: { id: updated.id, slug: updated.slug, updatedAt: updated.updatedAt.toISOString(), lockedFields: updated.lockedFields },
  };
}

/** Create a blank DRAFT so an operator always starts from a real row (which is
 *  what makes autosave, locking and the audit trail work from keystroke one). */
export async function createDraftEvent(actorId: string, input: { name: string; sport: string; date: string }): Promise<{ id: string; slug: string }> {
  const base = slugify(input.name) || "new-event";
  let slug = base;
  for (let i = 2; await prisma.event.findUnique({ where: { slug }, select: { id: true } }); i++) slug = `${base}-${i}`;

  const ev = await prisma.event.create({
    data: {
      slug,
      name: input.name.trim(),
      sport: (SPORTS.has(input.sport) ? input.sport : "MMA") as Prisma.EventCreateInput["sport"],
      date: new Date(input.date),
      status: "DRAFT",
      // A hand-built card is owned by its author from the start; ingest must not
      // "correct" a name or date the operator deliberately chose.
      lockedFields: ["name", "slug", "date", "sport", "status"],
    },
    select: { id: true, slug: true },
  });

  await prisma.auditLog.create({
    data: { actorId, action: "event.create", entity: "Event", entityId: ev.id, meta: { name: input.name, slug: ev.slug } },
  });
  return ev;
}

/**
 * Release fields back to the importers.
 *
 * Locking is one-way without this: an operator who edits a field by mistake
 * freezes it forever and the importer silently stops maintaining it. Unlocking
 * is itself audited, because "why did this start changing again?" is exactly as
 * important a question as "why did it stop?".
 */
export async function unlockEventFields(actorId: string, eventId: string, fields: string[]): Promise<{ ok: boolean; lockedFields: string[] }> {
  const before = await prisma.event.findUnique({ where: { id: eventId }, select: { lockedFields: true } });
  if (!before) return { ok: false, lockedFields: [] };
  const release = new Set(lockableEventFields(fields));
  const next = before.lockedFields.filter((f) => !release.has(f));
  if (next.length === before.lockedFields.length) return { ok: true, lockedFields: next };

  const [updated] = await prisma.$transaction([
    prisma.event.update({ where: { id: eventId }, data: { lockedFields: next }, select: { lockedFields: true } }),
    prisma.auditLog.create({
      data: { actorId, action: "event.unlock", entity: "Event", entityId: eventId, meta: { released: [...release] } as Prisma.JsonObject },
    }),
  ]);
  return { ok: true, lockedFields: updated.lockedFields };
}

/**
 * Revert one audited change.
 *
 * Undo is expressed as a normal edit — same validation, same locking, a new
 * audit entry — rather than a raw write. A revert that bypassed validation
 * could restore a state the card can no longer be in (a second main event, a
 * slug now taken), and a silent revert would be the one change with no trail.
 */
export async function undoEventChange(actorId: string, auditId: string): Promise<SaveResult> {
  const entry = await prisma.auditLog.findUnique({ where: { id: auditId } });
  if (!entry || entry.entity !== "Event" || entry.action !== "event.update") {
    return { ok: false, issues: [{ field: "id", message: "That entry cannot be undone." }] };
  }
  const changes = (entry.meta as { changes?: { field: string; from: unknown }[] } | null)?.changes ?? [];
  if (!changes.length) return { ok: false, issues: [{ field: "id", message: "Nothing to revert." }] };

  const patch: Record<string, unknown> = {};
  for (const c of changes) patch[c.field] = c.from;
  return saveEvent(actorId, entry.entityId, patch as EventPatch);
}

/** Audit history for one event, newest first. */
export async function getEventHistory(eventId: string, limit = 50) {
  const rows = await prisma.auditLog.findMany({
    where: { entity: { in: ["Event", "Fight"] }, entityId: eventId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, username: true } })
    : [];
  const byId = new Map(actors.map((a) => [a.id, a.name ?? a.username ?? "Staff"]));
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actor: r.actorId ? byId.get(r.actorId) ?? "Staff" : "System",
    at: r.createdAt.toISOString(),
    meta: r.meta as unknown,
  }));
}

export { LOCKABLE_EVENT_FIELDS };
