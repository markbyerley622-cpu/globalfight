import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/admin/guard";
import { generateAllP4P, generateAllDivisions } from "@/lib/rankings/generate";
import { SPORTS } from "@/lib/sports";

export const dynamic = "force-dynamic";
export const maxDuration = 120;


// Admin/cron-triggerable ranking generation job. Regenerates P4P AND
// divisional rankings for every sport/division that lacks curated rankings;
// curated (scraped) data is preserved in both.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  const secret = req.headers.get("x-cron-secret");
  const viaCron = secret && secret === process.env.SCRAPE_CRON_SECRET;
  if (!viaCron && (!user || !isAdminRole(user.role))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const sportValues = SPORTS.map((s) => s.value);
  const [p4p, divisions] = await Promise.all([generateAllP4P(sportValues), generateAllDivisions(sportValues)]);
  return NextResponse.json({ p4p, divisions });
}
