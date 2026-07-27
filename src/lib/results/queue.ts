import "server-only";
import type { FightMethod } from "@prisma/client";
import { prisma } from "@/lib/db";
import { log } from "@/lib/scraper/logger";
import { publishCandidate } from "./pipeline";

// ════════════════════════════════════════════════════════════════════════════
//  The operator review queue.
//
//  An operator must be able to decide in seconds, so a queue item carries
//  everything needed to judge it — the bout, the suggested reading, the confidence,
//  the reasons, and every source snippet — in ONE query. Making them click through
//  to evidence would make review slow, and a slow queue does not get used.
//
//  Every action is written to the audit log. "Who published this result and why" has
//  to be answerable months later, because a result moves reputation.
// ════════════════════════════════════════════════════════════════════════════

export type QueueFilter = "PENDING_REVIEW" | "CONFLICTED" | "INCONCLUSIVE" | "VERIFIED" | "REJECTED";

export async function listReviewQueue(filter: QueueFilter[] = ["CONFLICTED", "PENDING_REVIEW"], limit = 50) {
  const rows = await prisma.resultCandidate.findMany({
    where: { status: { in: filter } },
    // Conflicts first — they are the ones actively blocking a settlement.
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: limit,
    select: {
      id: true, fightId: true, outcome: true, winnerCorner: true, method: true,
      roundEnded: true, confidence: true, status: true, agreeing: true,
      disagreeing: true, reasons: true, updatedAt: true, publishedAt: true,
      fight: {
        select: {
          id: true, slug: true, date: true, result: true,
          red: { select: { name: true } },
          blue: { select: { name: true } },
          event: { select: { name: true, slug: true } },
        },
      },
    },
  });

  // Evidence in ONE query for the whole page, not one per row.
  const evidence = await prisma.resultEvidence.findMany({
    where: { fightId: { in: rows.map((r) => r.fightId) } },
    orderBy: { observedAt: "desc" },
    select: {
      fightId: true, sourceName: true, sourceKind: true, sourceUrl: true,
      headline: true, outcome: true, winnerCorner: true, method: true,
      roundEnded: true, quality: true, observedAt: true,
    },
  });
  const byFight = new Map<string, typeof evidence>();
  for (const e of evidence) byFight.set(e.fightId, [...(byFight.get(e.fightId) ?? []), e]);

  return rows.map((r) => ({
    ...r,
    reasons: Array.isArray(r.reasons) ? (r.reasons as string[]) : [],
    evidence: byFight.get(r.fightId) ?? [],
  }));
}

export interface ReviewDecision {
  action: "approve" | "reject" | "inconclusive";
  /** An operator may correct the reading before approving it. */
  edit?: {
    outcome?: "WIN" | "DRAW" | "NO_CONTEST";
    winnerCorner?: "RED" | "BLUE" | null;
    method?: FightMethod | null;
    roundEnded?: number | null;
  };
  note?: string;
}

/**
 * Record an operator's decision, and publish when they approve.
 *
 * `reviewedAt` is the flag that stops the hourly rescore from undoing this — see
 * rescoreCandidate. Approving sets VERIFIED and then calls the SAME publish gate the
 * automatic path uses, so a human-approved result and an auto-published one travel
 * identical code and settle identically.
 */
export async function reviewCandidate(
  operatorId: string,
  fightId: string,
  decision: ReviewDecision,
): Promise<{ ok: boolean; published: boolean; reason: string }> {
  const candidate = await prisma.resultCandidate.findUnique({
    where: { fightId },
    select: { status: true, publishedAt: true },
  });
  if (!candidate) return { ok: false, published: false, reason: "no candidate" };
  if (candidate.publishedAt) return { ok: false, published: false, reason: "already published" };

  const status =
    decision.action === "approve" ? "VERIFIED"
      : decision.action === "reject" ? "REJECTED"
        : "INCONCLUSIVE";

  await prisma.resultCandidate.update({
    where: { fightId },
    data: {
      status,
      // Only an approval may carry an edit; correcting a rejection is meaningless.
      ...(decision.action === "approve" && decision.edit
        ? {
            outcome: decision.edit.outcome,
            winnerCorner: decision.edit.winnerCorner,
            method: decision.edit.method,
            roundEnded: decision.edit.roundEnded,
          }
        : {}),
      reviewedById: operatorId,
      reviewedAt: new Date(),
      reviewNote: decision.note ?? null,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: operatorId,
      action: `result.${decision.action}`,
      entity: "ResultCandidate",
      entityId: fightId,
      meta: {
        note: decision.note ?? null,
        edit: (decision.edit ?? null) as never,
        previousStatus: candidate.status,
      },
    },
  }).catch((e) => log.warn({ err: (e as Error).message }, "results audit write failed"));

  if (decision.action !== "approve") {
    return { ok: true, published: false, reason: `marked ${status}` };
  }

  const { published, reason } = await publishCandidate(fightId);
  return { ok: true, published, reason };
}

/** Counts for the queue header and for observability. */
export async function reviewQueueStats() {
  const grouped = await prisma.resultCandidate.groupBy({
    by: ["status"],
    _count: { status: true },
  });
  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.status] = g._count.status;
  const published = await prisma.resultCandidate.count({ where: { publishedAt: { not: null } } });
  return { counts, published };
}
