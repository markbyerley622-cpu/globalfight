import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { reviewClaim } from "@/lib/fighters/profile";

const isAdmin = (role: string) => role === "ADMIN" || role === "MODERATOR";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const action = body.action;
  const note = typeof body.note === "string" ? body.note : undefined;
  if (action !== "approve" && action !== "reject" && action !== "info") {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  try {
    await reviewClaim(user.id, id, action, note);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not review claim." }, { status: 400 });
  }
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
