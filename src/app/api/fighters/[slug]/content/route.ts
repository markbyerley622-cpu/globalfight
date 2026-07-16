import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  updateProfileMeta, addAchievement, addSponsor, setSocial, addMedia, deleteChild,
} from "@/lib/fighters/profile";

// One owner-only endpoint for all website content. `type` selects the action.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const type = body.type;
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);

  try {
    switch (type) {
      case "meta":
        await updateProfileMeta(user.id, slug, {
          bio: str("bio"), tagline: str("tagline"), contactEmail: str("contactEmail"),
          imageUrl: str("imageUrl"), heroImageUrl: str("heroImageUrl"),
          website: str("website"), instagram: str("instagram"), twitter: str("twitter"),
        });
        return NextResponse.json({ ok: true });
      case "achievement": {
        if (!str("title")) return NextResponse.json({ error: "Title required." }, { status: 400 });
        const a = await addAchievement(user.id, slug, str("title")!, body.year ? Number(body.year) : undefined);
        return NextResponse.json({ id: a.id }, { status: 201 });
      }
      case "sponsor": {
        if (!str("name")) return NextResponse.json({ error: "Sponsor name required." }, { status: 400 });
        const s = await addSponsor(user.id, slug, str("name")!, str("url"), str("logoUrl"));
        return NextResponse.json({ id: s.id }, { status: 201 });
      }
      case "social": {
        if (!str("platform") || !str("url")) return NextResponse.json({ error: "Platform and URL required." }, { status: 400 });
        const s = await setSocial(user.id, slug, str("platform")!, str("url")!);
        return NextResponse.json({ id: s.id }, { status: 201 });
      }
      case "media": {
        const mt = str("mediaType") === "video" ? "video" : "photo";
        if (!str("url")) return NextResponse.json({ error: "URL required." }, { status: 400 });
        const m = await addMedia(user.id, slug, mt, str("url")!, str("caption"));
        return NextResponse.json({ id: m.id }, { status: 201 });
      }
      default:
        return NextResponse.json({ error: "Unknown content type." }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not save.";
    return NextResponse.json({ error: msg }, { status: msg.includes("own") ? 403 : 400 });
  }
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind") as "achievement" | "sponsor" | "social" | "media" | null;
  const id = searchParams.get("id");
  if (!kind || !id) return NextResponse.json({ error: "kind and id required." }, { status: 400 });
  try {
    await deleteChild(user.id, kind, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not delete.";
    return NextResponse.json({ error: msg }, { status: msg.includes("own") ? 403 : 400 });
  }
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
