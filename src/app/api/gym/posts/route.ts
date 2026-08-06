import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getFeed, createPost } from "@/lib/gym-posts/repo";
import { refusalOf } from "@/lib/gym-posts/errors";
import { FEED_PAGE_SIZE } from "@/lib/gym-posts/types";
import { hit, POLICY } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ════════════════════════════════════════════════════════════════════════════
//  The feed, and publishing to it.
//
//  This handler holds NO policy. Visibility, membership, the gym's verification
//  state, moderation and the media rules all live in lib/gym-posts, because
//  there will be other callers than this route and a rule enforced here would
//  only protect this door. Authenticate, parse, rate-limit, call.
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/gym/posts?gym=<slug>&cursor=<opaque>&limit=<n>
 *
 * Public. Anonymous callers see PUBLIC posts only; a signed-in caller
 * additionally sees the MEMBERS posts of gyms they belong to and their own
 * PRIVATE ones. That decision is made in the service layer, not here.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const user = await getCurrentUser().catch(() => null);

  const page = await getFeed({
    gymSlug: url.searchParams.get("gym"),
    cursor: url.searchParams.get("cursor"),
    limit: Number(url.searchParams.get("limit") ?? FEED_PAGE_SIZE),
    user,
  });

  return NextResponse.json(page, {
    // Never shared cache: the same URL yields different posts per viewer, and a
    // CDN that cached one member's MEMBERS-visible feed would serve it to
    // everybody. `private, no-store` is the only safe answer for a
    // viewer-dependent read.
    headers: { "cache-control": "private, no-store" },
  });
}

/** POST /api/gym/posts — publish. JSON only (CSRF: see CLAUDE.md rule 8). */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to post." }, { status: 401 });

  const gate = await hit(`gym-post:${user.id}`, POLICY.gymPost.limit, POLICY.gymPost.windowMs);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "You're posting a lot. Try again shortly." },
      { status: 429, headers: { "retry-after": String(gate.retryAfter) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const gymSlug = typeof body.gym === "string" ? body.gym : "";
  if (!gymSlug) return NextResponse.json({ error: "Which gym?" }, { status: 400 });

  try {
    const post = await createPost({
      gymSlug,
      authorId: user.id,
      authorRole: user.role,
      body: typeof body.body === "string" ? body.body : "",
      visibility: typeof body.visibility === "string" ? body.visibility : null,
      // Passed through unvalidated ON PURPOSE — normaliseAttachments and
      // assertAttachable own that, so the shape is checked in one place rather
      // than half here and half there.
      media: body.media,
    });
    return NextResponse.json({ ok: true, post }, { status: 201 });
  } catch (e) {
    const { error, status } = refusalOf(e);
    return NextResponse.json({ error }, { status });
  }
}
