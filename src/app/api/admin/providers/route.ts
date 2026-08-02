import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/admin/guard";
import { getProviderHealth } from "@/lib/admin/provider-health";

export const dynamic = "force-dynamic";

// Powers /admin/providers — the Provider Dashboard. Read-only: what each
// ingestion source has actually written, when it last wrote, and the recorded
// source ladder for everything not yet built. Admin-gated like every /admin API.
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  return NextResponse.json(await getProviderHealth());
}
