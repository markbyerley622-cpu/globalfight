import { NextResponse } from "next/server";
import { getFightersPageSafe } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = await getFightersPageSafe({
    sport: searchParams.get("sport") ?? undefined,
    country: searchParams.get("country") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    q: searchParams.get("q") ?? undefined,
    cursor: searchParams.get("cursor") ?? undefined,
    limit: Number(searchParams.get("limit")) || undefined,
  });
  return NextResponse.json(page);
}
