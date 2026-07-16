// GET /api/cron/ingest-feed — refresh the Combat Feed catalog from channel RSS.
// Matches the existing cron auth convention (SCRAPE_CRON_SECRET bearer token).
import { NextResponse } from "next/server";
import { ingestOnce } from "@/lib/feed/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(req: Request): boolean {
  const secret = process.env.SCRAPE_CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await ingestOnce();
  return NextResponse.json({ ok: !result.error, ...result });
}
