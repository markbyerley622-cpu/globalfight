import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, verifyPassword, SESSION_COOKIE, clearedCookieOptions } from "@/lib/auth";
import { deleteAllEvidenceForUser } from "@/lib/evidence/lifecycle";
import { anonymiseAuthoredContent } from "@/lib/account/tombstone";
import { hit, clientIp, POLICY } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Delete the signed-in user's account (UK GDPR Art. 17).
 *
 * Order matters: identity documents are destroyed in object storage FIRST, while
 * we can still read the claim rows that point at them. Deleting the user first
 * would cascade the claims away and strand the passports in the bucket with
 * nothing left in the database referencing them — unfindable, undeletable, and
 * still there.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Invalid request." }, { status: 415 });
  }

  const gate = await hit(`account-del:${clientIp(req)}`, POLICY.accountDelete.limit, POLICY.accountDelete.windowMs);
  if (!gate.ok) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  // Re-authenticate: account deletion is irreversible, so a stolen session alone
  // must not be enough to destroy someone's account.
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  if (row?.passwordHash) {
    const password = typeof body.password === "string" ? body.password : "";
    if (!password || !(await verifyPassword(password, row.passwordHash))) {
      return NextResponse.json({ error: "Password is incorrect." }, { status: 403 });
    }
  }

  // 1. Destroy identity evidence in object storage while the pointers still exist.
  const evidenceDeleted = await deleteAllEvidenceForUser(user.id);

  // 2. Anonymise authored DISCUSSION before the cascade can destroy it.
  //    ForumThread.author and ForumPost.author are onDelete: Cascade, so
  //    deleting the user took their threads with them — and a cascading thread
  //    takes every reply inside it, including other members' posts. One person
  //    erasing themselves was erasing other people's writing. Re-pointing at the
  //    tombstone keeps the conversation and drops the identity, which is the
  //    outcome both the reader and the departing user actually want.
  const anonymised = await anonymiseAuthoredContent(user.id);

  // 3. Record the erasure BEFORE the user row goes (the audit log's actorId is
  //    nullable, so the entry survives the delete).
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "account.delete",
      entity: "User",
      entityId: user.id,
      // Spread rather than nested: Prisma's Json input type does not accept an
      // arbitrary interface, and the three counts are more useful flat anyway.
      meta: {
        evidenceObjectsDeleted: evidenceDeleted,
        anonymisedThreads: anonymised.threads,
        anonymisedPosts: anonymised.posts,
        anonymisedQuotes: anonymised.quotes,
      },
    },
  });

  // 4. Delete the account. Claims, sessions, and tokens cascade.
  await prisma.user.delete({ where: { id: user.id } });

  const res = NextResponse.json({ ok: true, evidenceObjectsDeleted: evidenceDeleted });
  res.cookies.set(SESSION_COOKIE, "", clearedCookieOptions);
  return res;
}
