import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createFeedback, similarFeedback } from "@/lib/feedback";
import { hit, POLICY } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Similar items, for the "someone may have asked this already" step.
 *
 * Signed-in only — it is a search over the board reachable one keystroke at a
 * time, and there is no reason for an anonymous script to have it. The board
 * itself is public and paginated; this is the incremental variant.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const title = new URL(req.url).searchParams.get("title")?.trim() ?? "";
  if (title.length < 4) return NextResponse.json({ similar: [] });

  // Bounded: this runs per keystroke-ish from a form.
  const gate = await hit(`feedback-similar:${user.id}`, POLICY.forumPost.limit, POLICY.forumPost.windowMs);
  if (!gate.ok) return NextResponse.json({ similar: [] });

  return NextResponse.json({ similar: await similarFeedback(title) });
}

/**
 * File a new item.
 *
 * The author is the SESSION user. There is no `authorId` in the body and no
 * parameter in the service that accepts one, so forged authorship is not
 * something this endpoint has to defend against — it is not expressible.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Invalid request." }, { status: 415 });
  }

  const gate = await hit(`feedback-create:${user.id}`, POLICY.forumThread.limit, POLICY.forumThread.windowMs);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "You've posted a lot of feedback just now. Try again shortly." },
      { status: 429, headers: { "retry-after": String(gate.retryAfter) } },
    );
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  const result = await createFeedback(user.id, {
    title: typeof body.title === "string" ? body.title : "",
    body: typeof body.body === "string" ? body.body : "",
    category: typeof body.category === "string" ? body.category : "",
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, id: result.id }, { status: 201 });
}
