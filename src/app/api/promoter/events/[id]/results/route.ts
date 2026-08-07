import { NextResponse } from "next/server";
import type { FightMethod } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { enforceLimit } from "@/lib/rate-limit/guard";
import { POLICY } from "@/lib/rate-limit";
import { recordPromoterResult } from "@/lib/promoter/repo";

const METHODS = new Set<FightMethod>([
  "KO", "TKO", "UD", "SD", "MD", "SUB", "DQ", "RTD", "TD", "NC", "DRAW",
]);

/**
 * Record one bout's result, live from the venue.
 *
 * ── Access-control walk (CLAUDE.md rules 1–8) ───────────────────────────────
 * 1. Authenticated first — 401 before any work.
 * 2. Ownership is the service layer's: `recordPromoterResult` proves the fight
 *    belongs to an event belonging to the caller's organisation, in the same
 *    query that writes. A promoter cannot post a result onto somebody else's
 *    card by guessing a fight id.
 * 3. Allow-listed. `method` is checked against the enum, `round` and `time` are
 *    bounded, and `winner` is one of four words — nothing from the body reaches
 *    a column unvalidated.
 * 4. `updateMany` scoped by ownership: concurrency-safe, and a non-owner's
 *    write is a no-op rather than a P2025.
 * 6. A fight the caller does not own answers the same 404 as one that does not
 *    exist, so this is not an oracle for which events exist.
 *
 * Rate-limited under `interaction`: on fight night a promoter posts a dozen of
 * these in an hour, so the ceiling has to accommodate a real card.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to record a result." }, { status: 401 });

  const limited = await enforceLimit(req, "promoter-result", POLICY.interaction, user.id);
  if (limited) return limited;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    fightId?: string;
    winner?: string;
    method?: string;
    round?: number;
    time?: string;
  };

  const fightId = typeof body.fightId === "string" ? body.fightId : "";
  const winner = body.winner;
  if (!fightId || !["RED", "BLUE", "DRAW", "NO_CONTEST"].includes(String(winner))) {
    return NextResponse.json({ error: "Pick a winner first." }, { status: 400 });
  }

  const method = METHODS.has(body.method as FightMethod) ? (body.method as FightMethod) : null;
  // 15 is the longest a sanctioned bout has ever been. A round number outside
  // that is a typo, and storing it would corrupt the fight's own history.
  const round =
    typeof body.round === "number" && body.round >= 1 && body.round <= 15
      ? Math.floor(body.round)
      : null;
  const time = typeof body.time === "string" && /^\d{1,2}:\d{2}$/.test(body.time) ? body.time : null;

  try {
    await recordPromoterResult(user.id, id, {
      fightId,
      winner: winner as "RED" | "BLUE" | "DRAW" | "NO_CONTEST",
      method,
      round,
      time,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't save that result." },
      { status: 400 },
    );
  }
}

export const dynamic = "force-dynamic";
