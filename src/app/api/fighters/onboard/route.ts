import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { upsertFighterProfile, getFighterByOwner } from "@/lib/repo.prisma";
import { SPORTS } from "@/lib/sports";

const SPORT_VALUES = new Set<string>(SPORTS.map((s) => s.value));

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const profile = await getFighterByOwner(user.id);
  return NextResponse.json({ profile });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);
  const name = str("name")?.trim() ?? "";
  const sport = str("sport") ?? "";
  const nationality = str("nationality")?.trim() ?? "";
  const residence = str("residence")?.trim() ?? "";
  const active = body.active !== false;

  if (name.length < 2) return NextResponse.json({ error: "Fighter name is required." }, { status: 400 });
  if (!SPORT_VALUES.has(sport)) return NextResponse.json({ error: "Choose a valid sport." }, { status: 400 });
  if (!nationality) return NextResponse.json({ error: "Nationality is required." }, { status: 400 });
  if (!residence) return NextResponse.json({ error: "Residence is required." }, { status: 400 });

  try {
    const { slug } = await upsertFighterProfile(user.id, {
      name, sport, nationality, residence, active,
      nickname: str("nickname"), countryCode: str("countryCode"),
      bio: str("bio"), gym: str("gym"), promotion: str("promotion"),
      website: str("website"), instagram: str("instagram"), twitter: str("twitter"),
      wins: Number(body.wins) || 0, losses: Number(body.losses) || 0,
      draws: Number(body.draws) || 0, noContests: Number(body.noContests) || 0,
      beltRank: str("beltRank"), style: str("style"),
      federation: str("federation"), rank: str("rank"),
    });
    return NextResponse.json({ slug }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save profile." }, { status: 400 });
  }
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
