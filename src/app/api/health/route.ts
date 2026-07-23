import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liveness + readiness probe. Checks DB connectivity so a platform health check
// (Render `healthCheckPath`, a load balancer) can gate traffic on a working
// database rather than just a booting process. Returns 200 when healthy, 503
// when the DB is unreachable. Only up/down is exposed — never internal detail.
export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { status: "ok", db: "up", latencyMs: Date.now() - startedAt },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { status: "degraded", db: "down" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
