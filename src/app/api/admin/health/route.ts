import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/admin/guard";
import { auditDataHealth } from "@/lib/admin/data-health";

export const dynamic = "force-dynamic";

// Powers /admin/health — the Data Health Dashboard. Read-only audit of data
// completeness and integrity across fighters, events and rankings.
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  return NextResponse.json(await auditDataHealth());
}
