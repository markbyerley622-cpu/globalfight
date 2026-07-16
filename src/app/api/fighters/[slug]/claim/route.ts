import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getMyClaim, createClaim } from "@/lib/fighters/profile";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ claim: null });
  const claim = await getMyClaim(user.id, slug);
  return NextResponse.json({ claim });
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You must be signed in to claim a profile." }, { status: 401 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* evidence optional */ }
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);

  try {
    // No evidenceUrl: the identity document is attached server-side by the upload
    // route, against this user's own claim. A client-supplied storage URL would
    // let a caller point their claim at someone else's document.
    const claim = await createClaim(user.id, slug, {
      evidenceType: str("evidenceType"),
      evidenceNote: str("evidenceNote"),
    });
    return NextResponse.json({ claim: { status: claim.status } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not submit claim." }, { status: 400 });
  }
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
