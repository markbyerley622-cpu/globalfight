import "server-only";
import { prisma } from "@/lib/db";
import { publicDisplayName } from "@/lib/display-name";

// ════════════════════════════════════════════════════════════════════════════
//  THE REPORTS QUEUE — the read + write side of moderator review.
//
//  ── Why this exists ──────────────────────────────────────────────────────
//  Members could already file reports (ForumReport, /api/forums/report,
//  report-dialog.tsx) and every one of them landed in a table with NO READER.
//  Reports accumulated indefinitely, unseen, while the reporting UI told users
//  their report had been submitted. That is worse than having no report button:
//  it promises review that was never happening.
//
//  ── Why the queue resolves its own targets ───────────────────────────────
//  ForumReport is polymorphic — `targetType` + `targetId`, no foreign key — so
//  a moderator list needs the reported CONTENT alongside the report, and the
//  naive version is one query per row. This resolves every thread and every post
//  across the whole page in two batched queries regardless of page size.
//
//  Every state change here writes an AuditLog row. Nothing a moderator does is
//  invisible, including the decision to do nothing (a dismissal is an action).
// ════════════════════════════════════════════════════════════════════════════

export type ReportStatus = "OPEN" | "REVIEWED" | "DISMISSED";

export interface QueueItem {
  id: string;
  status: ReportStatus;
  reason: string;
  detail: string | null;
  createdAt: string;
  reporter: { name: string; username: string | null };
  targetType: "thread" | "post";
  targetId: string;
  /** Null when the reported content has since been hard-deleted. */
  target: {
    excerpt: string;
    authorName: string;
    authorUsername: string | null;
    /** Soft-deleted (hidden from readers) — posts only. */
    hidden: boolean;
    /** Where a moderator goes to see it in context. */
    href: string | null;
  } | null;
  /** How many DISTINCT members have reported this same target. */
  reportCount: number;
}

export interface QueueFilters {
  status?: ReportStatus | "ALL";
  reason?: string | "ALL";
  limit?: number;
}

/**
 * One page of the queue, newest first, with every target resolved.
 *
 * Query count is constant: reports → threads → posts → per-target counts. Four,
 * whether the page holds one report or fifty.
 */
export async function getReportQueue(filters: QueueFilters = {}): Promise<QueueItem[]> {
  const { status = "OPEN", reason = "ALL", limit = 50 } = filters;

  const reports = await prisma.forumReport.findMany({
    where: {
      ...(status === "ALL" ? {} : { status }),
      ...(reason === "ALL" ? {} : { reason }),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
    select: {
      id: true, targetType: true, targetId: true, reason: true, detail: true,
      status: true, createdAt: true,
      reporter: { select: { name: true, username: true } },
    },
  });
  if (reports.length === 0) return [];

  const threadIds = reports.filter((r) => r.targetType === "thread").map((r) => r.targetId);
  const postIds = reports.filter((r) => r.targetType === "post").map((r) => r.targetId);

  const [threads, posts, counts] = await Promise.all([
    threadIds.length
      ? prisma.forumThread.findMany({
          where: { id: { in: threadIds } },
          select: {
            id: true, title: true, slug: true,
            category: { select: { slug: true } },
            author: { select: { name: true, username: true } },
          },
        })
      : [],
    postIds.length
      ? prisma.forumPost.findMany({
          where: { id: { in: postIds } },
          select: {
            id: true, content: true, deleted: true,
            thread: { select: { slug: true, category: { select: { slug: true } } } },
            author: { select: { name: true, username: true } },
          },
        })
      : [],
    // "Three people reported this" is the single most useful signal on the page
    // and the one a moderator would otherwise have to count by eye.
    prisma.forumReport.groupBy({
      by: ["targetType", "targetId"],
      where: { targetId: { in: [...threadIds, ...postIds] } },
      _count: { _all: true },
    }),
  ]);

  const threadById = new Map(threads.map((t) => [t.id, t]));
  const postById = new Map(posts.map((p) => [p.id, p]));
  const countFor = new Map(counts.map((c) => [`${c.targetType}:${c.targetId}`, c._count._all]));

  return reports.map((r): QueueItem => {
    const targetType = r.targetType === "thread" ? "thread" : "post";
    let target: QueueItem["target"] = null;

    if (targetType === "thread") {
      const t = threadById.get(r.targetId);
      if (t) {
        target = {
          excerpt: t.title,
          authorName: publicDisplayName(t.author),
          authorUsername: t.author.username,
          hidden: false,
          href: `/forums/${t.category.slug}/${t.slug}`,
        };
      }
    } else {
      const p = postById.get(r.targetId);
      if (p) {
        target = {
          excerpt: p.content.slice(0, 400),
          authorName: publicDisplayName(p.author),
          authorUsername: p.author.username,
          hidden: p.deleted,
          href: p.thread ? `/forums/${p.thread.category.slug}/${p.thread.slug}` : null,
        };
      }
    }

    return {
      id: r.id,
      status: r.status as ReportStatus,
      reason: r.reason,
      detail: r.detail,
      createdAt: r.createdAt.toISOString(),
      reporter: { name: publicDisplayName(r.reporter), username: r.reporter.username },
      targetType,
      targetId: r.targetId,
      target,
      reportCount: countFor.get(`${r.targetType}:${r.targetId}`) ?? 1,
    };
  });
}

export type ModeratorAction = "hide" | "restore" | "dismiss" | "resolve";

/** Which report statuses each action lands the report in. */
const RESULTING_STATUS: Record<ModeratorAction, ReportStatus> = {
  hide: "REVIEWED",
  restore: "REVIEWED",
  dismiss: "DISMISSED",
  resolve: "REVIEWED",
};

export interface ActionResult {
  ok: boolean;
  status?: ReportStatus;
  error?: string;
}

/**
 * Apply a moderator decision and record it.
 *
 * HIDE is a soft-delete (`ForumPost.deleted`), never a row removal: a hard
 * delete would tear the reply chain and destroy the evidence for an appeal. The
 * post stops rendering; the record stays.
 *
 * Thread-level hiding is deliberately NOT offered here. Hiding a thread hides
 * everyone's replies inside it, which is the same collateral problem that made
 * account deletion destructive — it needs its own deliberate flow, not a button
 * that looks like the post one.
 */
export async function applyModeratorAction(input: {
  reportId: string;
  moderatorId: string;
  action: ModeratorAction;
  note?: string;
}): Promise<ActionResult> {
  const report = await prisma.forumReport.findUnique({
    where: { id: input.reportId },
    select: { id: true, targetType: true, targetId: true, status: true },
  });
  if (!report) return { ok: false, error: "That report no longer exists." };

  if (input.action === "hide" || input.action === "restore") {
    if (report.targetType !== "post") {
      return { ok: false, error: "Only posts can be hidden or restored from the queue." };
    }
    const hidden = input.action === "hide";
    // updateMany, not update: a post hard-deleted between the queue rendering
    // and the click would throw P2025 on update() and leak the model name to the
    // client (CLAUDE.md rule 5). This simply affects zero rows.
    const touched = await prisma.forumPost.updateMany({
      where: { id: report.targetId },
      data: { deleted: hidden },
    });
    if (touched.count === 0) return { ok: false, error: "That post no longer exists." };
  }

  const status = RESULTING_STATUS[input.action];
  await prisma.forumReport.update({ where: { id: report.id }, data: { status } });

  // The audit entry is the point of the whole console: every decision is
  // attributable, including "dismissed", which is the one most worth being able
  // to review later.
  await prisma.auditLog.create({
    data: {
      actorId: input.moderatorId,
      action: `moderation.${input.action}`,
      entity: "ForumReport",
      entityId: report.id,
      meta: {
        targetType: report.targetType,
        targetId: report.targetId,
        note: input.note?.slice(0, 500) ?? null,
        previousStatus: report.status,
        newStatus: status,
      },
    },
  });

  return { ok: true, status };
}

export interface HistoryEntry {
  id: string;
  action: string;
  createdAt: string;
  moderator: string;
  note: string | null;
  targetType: string | null;
  targetId: string | null;
}

/**
 * Moderation history — every decision, newest first. Moderator-only.
 *
 * Read from AuditLog rather than a second table: those rows already exist, are
 * already written in the same shape as claim and admin actions, and a parallel
 * history table would be a second truth to keep in step.
 */
export async function getModerationHistory(limit = 50): Promise<HistoryEntry[]> {
  const rows = await prisma.auditLog.findMany({
    where: { action: { startsWith: "moderation." } },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
    select: { id: true, action: true, createdAt: true, actorId: true, meta: true },
  });
  if (rows.length === 0) return [];

  // One batched lookup for the actor names rather than a relation per row.
  const actorIds = [...new Set(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])))];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, username: true } })
    : [];
  const nameById = new Map(actors.map((a) => [a.id, publicDisplayName(a)]));

  return rows.map((r) => {
    const meta = (r.meta ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      action: r.action.replace(/^moderation\./, ""),
      createdAt: r.createdAt.toISOString(),
      moderator: (r.actorId && nameById.get(r.actorId)) || "Unknown",
      note: typeof meta.note === "string" ? meta.note : null,
      targetType: typeof meta.targetType === "string" ? meta.targetType : null,
      targetId: typeof meta.targetId === "string" ? meta.targetId : null,
    };
  });
}
