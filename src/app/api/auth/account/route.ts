import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAFE_SELECT = {
  id: true, name: true, email: true, username: true, image: true, bannerUrl: true,
  registryRole: true, role: true, reputation: true,
} as const;

// Update the signed-in user's account fields (name / username / email).
export async function POST(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Sign in to update your account." }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  const data: { name?: string | null; username?: string; email?: string } = {};

  if (typeof body.name === "string") data.name = body.name.trim() || null;

  if (typeof body.username === "string") {
    const u = body.username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(u)) {
      return NextResponse.json({ error: "Username must be 3–20 characters: letters, numbers or underscore." }, { status: 400 });
    }
    const clash = await prisma.user.findFirst({ where: { username: u, NOT: { id: uid } }, select: { id: true } });
    if (clash) return NextResponse.json({ error: "That username is already taken." }, { status: 409 });
    data.username = u;
  }

  if (typeof body.email === "string") {
    const e = body.email.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    const clash = await prisma.user.findFirst({ where: { email: e, NOT: { id: uid } }, select: { id: true } });
    if (clash) return NextResponse.json({ error: "That email is already in use." }, { status: 409 });
    data.email = e;
  }

  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  const user = await prisma.user.update({ where: { id: uid }, data, select: SAFE_SELECT });
  return NextResponse.json({ user });
}
