import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/admin/guard";
import { repairDuplicateFighters } from "@/lib/admin/merge-fighters";
import { enrichPending } from "@/lib/enrich/enrich";
import { enrichArticleImages } from "@/lib/news/og-images";
import { ingestAllRankings } from "@/lib/rankings/ingest";
import { ingestCuratedP4P } from "@/lib/rankings/curated/ingest";
import { generateAllP4P } from "@/lib/rankings/generate";
import { SPORTS } from "@/lib/sports";

export const dynamic = "force-dynamic";

// Operations Console — one-click maintenance actions behind the Data Health
// Dashboard. Each action runs a REAL, idempotent repair/refresh job and returns
// what it did; the dashboard re-scans afterwards to show the count move.
// Read/-mutating admin actions only; every action is safe to re-run.
const ACTIONS = {
  "repair-duplicates": async () => repairDuplicateFighters(),
  "enrich-photos": async () => enrichPending(50),
  "enrich-article-images": async () => enrichArticleImages(50),
  "refresh-rankings": async () => ({ ingested: await ingestAllRankings() }),
  "refresh-p4p": async () => ({
    curated: await ingestCuratedP4P(),
    generated: await generateAllP4P(SPORTS.map((s) => s.value)),
  }),
} as const;

type Action = keyof typeof ACTIONS;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  if (!action || !(action in ACTIONS)) {
    return NextResponse.json({ error: `Unknown action. Valid: ${Object.keys(ACTIONS).join(", ")}` }, { status: 400 });
  }

  const started = Date.now();
  try {
    const result = await ACTIONS[action as Action]();
    return NextResponse.json({ ok: true, action, durationMs: Date.now() - started, result });
  } catch (e) {
    return NextResponse.json({ ok: false, action, error: (e as Error).message }, { status: 500 });
  }
}
