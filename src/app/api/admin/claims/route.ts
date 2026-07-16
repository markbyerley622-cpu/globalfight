import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listClaims } from "@/lib/fighters/profile";

const isAdmin = (role: string) => role === "ADMIN" || role === "MODERATOR";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const status = new URL(req.url).searchParams.get("status") ?? undefined;
  const claims = await listClaims(status);
  return NextResponse.json({ claims });
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
