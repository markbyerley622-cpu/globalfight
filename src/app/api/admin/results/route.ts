import { NextResponse } from "next/server";
import type { FightMethod } from "@prisma/client";
import { requireAdminApi } from "@/lib/admin/guard";
import { listReviewQueue, reviewCandidate, reviewQueueStats, type QueueFilter } from "@/lib/results/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTERS: QueueFilter[] = ["PENDING_REVIEW", "CONFLICTED", "INCONCLUSIVE", "VERIFIED", "REJECTED"];

/** The review queue + counts. Admin only — this endpoint can settle bouts. */
export async function GET(req: Request) {
  const user = await requireAdminApi();
  if (!user) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const raw = new URL(req.url).searchParams.get("status");
  const requested = (raw?.split(",") ?? []).filter((s): s is QueueFilter =>
    FILTERS.includes(s as QueueFilter),
  );
  const filter = requested.length ? requested : (["CONFLICTED", "PENDING_REVIEW"] as QueueFilter[]);

  const [items, stats] = await Promise.all([listReviewQueue(filter), reviewQueueStats()]);
  return NextResponse.json({ items, stats });
}

const METHODS: FightMethod[] = ["KO", "TKO", "UD", "SD", "MD", "SUB", "DQ", "RTD", "TD", "NC", "DRAW"];

/**
 * Record a decision. Approving PUBLISHES the result and settles the bout, so this is
 * the most consequential admin endpoint in the app — every field is validated rather
 * than trusted, and the whole thing is behind requireAdminApi.
 */
export async function POST(req: Request) {
  const user = await requireAdminApi();
  if (!user) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  const fightId = typeof body.fightId === "string" ? body.fightId : "";
  const action = body.action;
  if (!fightId) return NextResponse.json({ error: "Missing fightId." }, { status: 400 });
  if (action !== "approve" && action !== "reject" && action !== "inconclusive") {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  // An edit is only meaningful on an approval, and every field is checked against the
  // enum/range rather than passed through — this writes to Fight.result. Typed guards
  // rather than inline ternaries so the literal types actually narrow.
  type Outcome = "WIN" | "DRAW" | "NO_CONTEST";
  type Corner = "RED" | "BLUE";
  const isOutcome = (v: unknown): v is Outcome => v === "WIN" || v === "DRAW" || v === "NO_CONTEST";
  const isCorner = (v: unknown): v is Corner => v === "RED" || v === "BLUE";
  const isMethod = (v: unknown): v is FightMethod => METHODS.includes(v as FightMethod);

  const rawEdit = (body.edit ?? null) as Record<string, unknown> | null;
  const edit = rawEdit
    ? {
        outcome: isOutcome(rawEdit.outcome) ? rawEdit.outcome : undefined,
        winnerCorner: isCorner(rawEdit.winnerCorner)
          ? rawEdit.winnerCorner
          : rawEdit.winnerCorner === null
            ? null
            : undefined,
        method: isMethod(rawEdit.method) ? rawEdit.method : rawEdit.method === null ? null : undefined,
        roundEnded:
          typeof rawEdit.roundEnded === "number" && rawEdit.roundEnded >= 1 && rawEdit.roundEnded <= 15
            ? Math.floor(rawEdit.roundEnded)
            : rawEdit.roundEnded === null
              ? null
              : undefined,
      }
    : undefined;

  // A WIN with no corner would write result=WIN and winnerId=blue by default, which
  // is a coin flip on someone's reputation.
  if (edit?.outcome === "WIN" && edit.winnerCorner === undefined) {
    return NextResponse.json({ error: "A WIN needs a winning corner." }, { status: 400 });
  }

  const note = typeof body.note === "string" ? body.note.slice(0, 500) : undefined;
  const result = await reviewCandidate(user.id, fightId, { action, edit, note });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });
  return NextResponse.json(result);
}
