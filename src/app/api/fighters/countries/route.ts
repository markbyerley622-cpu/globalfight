import { NextResponse } from "next/server";
import { getFighterCountriesSafe } from "@/lib/repo";

export const revalidate = 3600;

export async function GET() {
  const countries = await getFighterCountriesSafe();
  return NextResponse.json({ countries });
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
