import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin/guard";
import {
  getReportQueue, applyModeratorAction, getModerationHistory,
  type ReportStatus, type ModeratorAction,
} from "@/lib/moderation/reports";
import { enforceLimit } from "@/lib/rate-limit/guard";
import { POLICY } from "@/lib/rate-limit";

/**
 * The moderator console's data endpoint.
 *
 * Access-control walk (CLAUDE.md rules 1–8):
 *  1. `requireAdminApi` first, on BOTH verbs — 403 for anyone who is not staff,
 *     and the authorisation decision comes from the one `isAdminRole` definition
 *     rather than a hand-written role comparison.
 *  3. The body is allow-listed to `reportId | action | note`; nothing here can
 *     mass-assign a status or an actor. The moderator id comes from the SESSION,
 *     never from the request, so a moderator cannot attribute a decision to a
 *     colleague.
 *  4. The write is an `updateMany` guard inside the service, so a target deleted
 *     mid-review affects zero rows instead of raising a P2025.
 *  5. Only our own sentences reach the client.
 *  8. JSON POST behind the sameSite=lax session cookie — a cross-site form post
 *     cannot reach it.
 */

const ACTIONS: ModeratorAction[] = ["hide", "restore", "dismiss", "resolve"];
const STATUSES = ["OPEN", "REVIEWED", "DISMISSED", "ALL"];

export async function GET(req: Request) {
  const admin = await requireAdminApi();
  if (!admin) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status") ?? "OPEN";
  const status = (STATUSES.includes(statusParam) ? statusParam : "OPEN") as ReportStatus | "ALL";
  const reason = url.searchParams.get("reason") ?? "ALL";

  const [reports, history] = await Promise.all([
    getReportQueue({ status, reason }),
    // Fetched alongside rather than from a second route: the console shows both
    // panels at once, and two round-trips for one screen is one too many.
    url.searchParams.get("history") === "1" ? getModerationHistory() : Promise.resolve([]),
  ]);

  return NextResponse.json({ reports, history });
}

export async function POST(req: Request) {
  const admin = await requireAdminApi();
  if (!admin) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  // Bounded even for staff: a compromised moderator account is exactly the case
  // where an unbounded write loop does the most damage.
  const limited = await enforceLimit(req, "moderation-action", POLICY.interaction, admin.id);
  if (limited) return limited;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  const reportId = typeof body.reportId === "string" ? body.reportId : null;
  const action = typeof body.action === "string" && ACTIONS.includes(body.action as ModeratorAction)
    ? (body.action as ModeratorAction)
    : null;
  const note = typeof body.note === "string" ? body.note : undefined;

  if (!reportId || !action) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const result = await applyModeratorAction({ reportId, moderatorId: admin.id, action, note });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}

export const dynamic = "force-dynamic";
