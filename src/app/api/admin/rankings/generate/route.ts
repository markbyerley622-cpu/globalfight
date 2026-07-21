import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/admin/guard";
import { generateAllP4P } from "@/lib/rankings/generate";
import { SPORTS } from "@/lib/sports";

export const dynamic = "force-dynamic";
export const maxDuration = 120;


// Admin/cron-triggerable ranking generation job. Regenerates P4P for every
// sport that lacks curated rankings; curated (scraped) data is preserved.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  const secret = req.headers.get("x-cron-secret");
  const viaCron = secret && secret === process.env.SCRAPE_CRON_SECRET;
  if (!viaCron && (!user || !isAdminRole(user.role))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const results = await generateAllP4P(SPORTS.map((s) => s.value));
  return NextResponse.json({ results });
}
