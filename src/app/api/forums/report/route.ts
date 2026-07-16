import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createReport } from "@/lib/forum/repo";

const REASONS = ["spam", "harassment", "off_topic", "misinformation", "other"];

/** File a moderation report against a thread or post. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to report." }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  const targetType = body.targetType === "thread" || body.targetType === "post" ? body.targetType : null;
  const targetId = typeof body.targetId === "string" ? body.targetId : "";
  const reason = typeof body.reason === "string" && REASONS.includes(body.reason) ? body.reason : "other";
  const detail = typeof body.detail === "string" ? body.detail.slice(0, 1000) : undefined;

  if (!targetType || !targetId) return NextResponse.json({ error: "Nothing to report." }, { status: 400 });

  try {
    await createReport({ reporterId: user.id, targetType, targetId, reason, detail });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not file report." }, { status: 400 });
  }
}

export const dynamic = "force-dynamic";
