import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deleteThread } from "@/lib/forum/repo";

const isAdmin = (role: string) => role === "ADMIN" || role === "MODERATOR";

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

  try {
    const out = await deleteThread({ threadSlug: slug, userId: user.id, isAdmin: isAdmin(user.role) });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not delete thread.";
    return NextResponse.json({ error: msg }, { status: msg.includes("only") ? 403 : 400 });
  }
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
