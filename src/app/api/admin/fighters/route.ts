import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/admin/guard";

/** Fighter typeahead for the card editor. Indexed name search, capped. */
export async function GET(req: Request) {
  const user = await requireAdminApi();
  if (!user) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ fighters: [] });

  const rows = await prisma.fighter.findMany({
    where: { name: { contains: q, mode: "insensitive" } },
    orderBy: [{ wins: "desc" }, { name: "asc" }],
    take: 12,
    select: { id: true, name: true, sport: true, wins: true, losses: true, draws: true },
  });

  return NextResponse.json({
    fighters: rows.map((f) => ({
      id: f.id, name: f.name, sport: f.sport,
      record: f.wins || f.losses || f.draws ? `${f.wins}-${f.losses}${f.draws ? `-${f.draws}` : ""}` : "—",
    })),
  });
}

export const dynamic = "force-dynamic";
