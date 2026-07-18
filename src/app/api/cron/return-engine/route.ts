import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/scraper/cron-handler";
import { runReturnEngine } from "@/lib/intelligence/return-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The Return Engine entrypoint. Emits event_soon (starts within ~30h) and
// event_live reminders to each event's audience (promotion/fighter followers +
// pickers), deduped per user. Idempotent — safe to run hourly.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const started = Date.now();
  try {
    const out = await runReturnEngine();
    return NextResponse.json({ ok: true, kind: "return-engine", durationMs: Date.now() - started, ...out });
  } catch (e) {
    return NextResponse.json({ ok: false, kind: "return-engine", error: (e as Error).message }, { status: 500 });
  }
}
