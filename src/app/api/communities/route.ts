import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { getCommunities } from "@/lib/community/repo";

export async function GET() {
  const viewerId = (await getSessionUserId()) ?? undefined;
  const communities = await getCommunities(viewerId);
  return NextResponse.json({ communities });
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
