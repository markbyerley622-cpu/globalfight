import "server-only";
import type { FightMethod, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { log } from "@/lib/scraper/logger";
import { onResultWritten } from "@/lib/intelligence/resolve";
import { extractOutcome, type Corner, type Method } from "./extract";
import { scoreCandidate, DEFAULT_THRESHOLDS, type EvidenceInput } from "./confidence";
import { sourceKindFor, hostOf } from "./sources";

// ════════════════════════════════════════════════════════════════════════════
//  Results Intelligence — the orchestrator.
//
//    sources → evidence → candidate → (auto-publish | operator queue) → settlement
//
//  ── THE ONE INVARIANT ─────────────────────────────────────────────────────
//  Nothing in this file writes Fight.result except publishCandidate(), and that
//  function refuses anything whose status is not VERIFIED. Evidence and candidates
//  are inert records; settlement happens exactly where it always did — the result
//  WRITE, via onResultWritten — so predictions, reputation and notifications keep
//  their single trigger and cannot be fired by a headline.
//
//  ── WHY WIKIPEDIA IS UNTOUCHED ────────────────────────────────────────────
//  The wikicard sync still writes results directly, exactly as before. It is the
//  conservative, authoritative path and this subsystem exists to be FASTER than it,
//  not to gate it. Wikipedia is recorded as evidence too, so a candidate can say
//  "Wikipedia agrees" — but if this whole pipeline were deleted tomorrow, results
//  would still land the way they do today.
// ════════════════════════════════════════════════════════════════════════════

/** Only bouts this recent are worth scanning — news about a fight goes cold fast. */
const EVIDENCE_WINDOW_DAYS = 14;

/** Articles to consider per pass. Bounded so a cron tick has a predictable cost. */
const ARTICLE_SCAN = 300;

const asMethod = (m: Method | null): FightMethod | null => (m as FightMethod | null);

/**
 * Read every article that might describe this bout and record what each one says.
 *
 * Matching is done by the EXTRACTOR, which requires both fighters to be named — so
 * this deliberately over-fetches candidate articles and lets extraction reject them.
 * That is the right division: the cheap query is broad, the careful logic is one
 * place, and a co-main report cannot leak onto the main event.
 *
 * Returns how many NEW pieces of evidence were recorded.
 */
export async function collectEvidence(fightId: string): Promise<number> {
  const fight = await prisma.fight.findUnique({
    where: { id: fightId },
    select: {
      id: true, date: true, result: true,
      red: { select: { name: true } },
      blue: { select: { name: true } },
    },
  });
  if (!fight) return 0;

  // Articles published from the day before the bout onwards. Earlier pieces are
  // previews by definition, and the extractor would reject them anyway — this just
  // avoids reading them.
  const since = new Date(+fight.date - 36 * 3600_000);
  const articles = await prisma.article.findMany({
    where: { publishedAt: { gte: since }, status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    take: ARTICLE_SCAN,
    select: { id: true, title: true, excerpt: true, sourceUrl: true, publishedAt: true },
  });

  const bout = { redName: fight.red.name, blueName: fight.blue.name };
  let recorded = 0;

  for (const a of articles) {
    // Headline + excerpt only. The full body would dilute position-based winner
    // detection and pull in unrelated bouts from a round-up.
    const text = [a.title, a.excerpt].filter(Boolean).join(". ");
    const reading = extractOutcome(text, bout);
    if (!reading) continue;

    const kind = sourceKindFor(a.sourceUrl);
    try {
      await prisma.resultEvidence.upsert({
        where: { fightId_sourceUrl: { fightId, sourceUrl: a.sourceUrl ?? a.id } },
        // A re-run must not manufacture a second agreeing voice, so the same source
        // article updates in place.
        update: {
          outcome: reading.outcome,
          winnerCorner: reading.winner,
          method: asMethod(reading.method),
          roundEnded: reading.round,
          quality: reading.quality,
        },
        create: {
          fightId,
          sourceKind: kind,
          sourceName: hostOf(a.sourceUrl) ?? "unknown",
          sourceUrl: a.sourceUrl ?? a.id,
          headline: a.title,
          snippet: a.excerpt ?? null,
          outcome: reading.outcome,
          winnerCorner: reading.winner,
          method: asMethod(reading.method),
          roundEnded: reading.round,
          quality: reading.quality,
          observedAt: a.publishedAt,
        },
      });
      recorded += 1;
    } catch (e) {
      log.warn({ op: "results.evidence", fightId, err: (e as Error).message }, "evidence write failed");
    }
  }

  return recorded;
}

/**
 * Score a bout's evidence into its single current candidate.
 *
 * Recomputed from scratch every time rather than incrementally updated: the
 * confidence of a reading depends on ALL the evidence, and an incremental update
 * would let an early weak candidate persist after the evidence that justified it was
 * superseded.
 */
export async function rescoreCandidate(fightId: string) {
  const rows = await prisma.resultEvidence.findMany({
    where: { fightId },
    select: {
      sourceUrl: true, sourceKind: true, outcome: true, winnerCorner: true,
      method: true, roundEnded: true, quality: true, observedAt: true,
    },
  });
  if (!rows.length) return null;

  const evidence: EvidenceInput[] = rows.map((r) => ({
    sourceUrl: r.sourceUrl,
    // OPERATOR is not a scoring kind — an operator decision does not go through the
    // confidence engine at all, it goes straight to VERIFIED.
    sourceKind: r.sourceKind === "OPERATOR" ? undefined : r.sourceKind,
    outcome: r.outcome as EvidenceInput["outcome"],
    winner: (r.winnerCorner as Corner | null) ?? null,
    method: (r.method as Method | null) ?? null,
    round: r.roundEnded,
    quality: r.quality,
    observedAt: r.observedAt,
  }));

  const scored = scoreCandidate(evidence, DEFAULT_THRESHOLDS);
  if (!scored) return null;

  // A candidate a human already decided is NOT overwritten by a later rescore.
  // Otherwise an operator's rejection would be undone by the next cron tick, and a
  // verified result could silently revert to PENDING_REVIEW.
  const existing = await prisma.resultCandidate.findUnique({
    where: { fightId },
    select: { status: true, reviewedAt: true },
  });
  if (existing?.reviewedAt) return existing;

  return prisma.resultCandidate.upsert({
    where: { fightId },
    update: {
      outcome: scored.outcome,
      winnerCorner: scored.winner,
      method: asMethod(scored.method),
      roundEnded: scored.round,
      confidence: scored.confidence,
      status: scored.status,
      agreeing: scored.agreeing,
      disagreeing: scored.disagreeing,
      reasons: scored.reasons as unknown as Prisma.InputJsonValue,
    },
    create: {
      fightId,
      outcome: scored.outcome,
      winnerCorner: scored.winner,
      method: asMethod(scored.method),
      roundEnded: scored.round,
      confidence: scored.confidence,
      status: scored.status,
      agreeing: scored.agreeing,
      disagreeing: scored.disagreeing,
      reasons: scored.reasons as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * Write a VERIFIED candidate onto the bout, and settle.
 *
 * THE GATE. Every other path into this subsystem is inert; this is the only function
 * that touches Fight.result, and it refuses:
 *   · any status other than VERIFIED — a candidate is not a result;
 *   · a bout that is already decided — a later reading must not silently rewrite a
 *     recorded outcome, which would re-grade settled predictions;
 *   · a candidate already published — the stamp makes a re-run a no-op.
 *
 * Settlement is delegated to onResultWritten, the same trigger the ingest and the
 * admin editor use, so there is exactly one settlement path in the codebase.
 */
export async function publishCandidate(fightId: string): Promise<{ published: boolean; reason: string }> {
  const candidate = await prisma.resultCandidate.findUnique({
    where: { fightId },
    select: {
      status: true, publishedAt: true, outcome: true, winnerCorner: true,
      method: true, roundEnded: true,
      fight: { select: { id: true, result: true, redId: true, blueId: true } },
    },
  });
  if (!candidate) return { published: false, reason: "no candidate" };
  if (candidate.status !== "VERIFIED") return { published: false, reason: `status is ${candidate.status}` };
  if (candidate.publishedAt) return { published: false, reason: "already published" };
  if (candidate.fight.result !== "SCHEDULED") {
    return { published: false, reason: "bout already has a result" };
  }

  const winnerId =
    candidate.outcome === "WIN"
      ? candidate.winnerCorner === "RED"
        ? candidate.fight.redId
        : candidate.fight.blueId
      : null;

  const result =
    candidate.outcome === "WIN" ? "WIN" : candidate.outcome === "DRAW" ? "DRAW" : "NO_CONTEST";

  await prisma.fight.update({
    where: { id: fightId },
    data: {
      result,
      winnerId,
      method: candidate.method,
      roundEnded: candidate.roundEnded,
    },
  });
  await prisma.resultCandidate.update({
    where: { fightId },
    data: { publishedAt: new Date() },
  });

  log.info({ op: "results.publish", fightId, result, winnerId }, "verified result published");

  // The single settlement trigger. Never throws — the result is the fact.
  await onResultWritten(fightId, "results-intelligence");

  return { published: true, reason: "published" };
}

/**
 * One pass over recently-finished, undecided bouts.
 *
 * Bounded and idempotent, so it is safe on any cadence. Auto-publishes only what the
 * confidence engine marked VERIFIED; everything else lands in the operator queue.
 */
export async function runResultsIntelligence(limit = 40): Promise<{
  scanned: number;
  evidence: number;
  verified: number;
  queued: number;
  conflicted: number;
}> {
  const since = new Date(Date.now() - EVIDENCE_WINDOW_DAYS * 86_400_000);
  const fights = await prisma.fight.findMany({
    where: {
      result: "SCHEDULED",
      cancelled: false,
      date: { gte: since, lt: new Date() },
    },
    orderBy: { date: "desc" },
    take: limit,
    select: { id: true },
  });

  const out = { scanned: fights.length, evidence: 0, verified: 0, queued: 0, conflicted: 0 };

  for (const f of fights) {
    try {
      out.evidence += await collectEvidence(f.id);
      const candidate = await rescoreCandidate(f.id);
      if (!candidate) continue;
      if (candidate.status === "VERIFIED") {
        const { published } = await publishCandidate(f.id);
        if (published) out.verified += 1;
      } else if (candidate.status === "CONFLICTED") {
        out.conflicted += 1;
      } else if (candidate.status === "PENDING_REVIEW") {
        out.queued += 1;
      }
    } catch (e) {
      // One bad bout must not abort the pass.
      log.warn({ op: "results.intel", fightId: f.id, err: (e as Error).message }, "bout pass failed");
    }
  }

  log.info({ op: "results.intel", ...out }, "results intelligence pass");
  return out;
}
