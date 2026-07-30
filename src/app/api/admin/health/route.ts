import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/admin/guard";
import { auditDataHealth } from "@/lib/admin/data-health";
import { auditCronHealth } from "@/lib/admin/cron-health";

export const dynamic = "force-dynamic";

// Powers /admin/health — the Data Health Dashboard. Read-only audit of data
// completeness and integrity across fighters, events and rankings, plus the cron
// run history (did each scheduled job fire, and did it succeed?).
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  // Independent audits, so one throwing must not blank the other — a data-health
  // query failing is precisely when you want the cron panel readable.
  const [data, cron] = await Promise.all([auditDataHealth(), auditCronHealth()]);
  return NextResponse.json({ ...data, cron });
}
