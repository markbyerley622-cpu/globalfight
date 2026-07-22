import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/admin/guard";

/** Gym ownership claims awaiting review. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const status = new URL(req.url).searchParams.get("status") ?? "pending";
  const claims = await prisma.gymClaim.findMany({
    where: status === "all" ? undefined : { status },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, status: true, evidence: true, note: true, createdAt: true, reviewedAt: true,
      // Presence + scan state only. evidenceStorageKey is NEVER selected here:
      // it is the one value that must not reach a client, even an admin's.
      evidenceUploadedAt: true, evidenceScanStatus: true,
      evidenceContentType: true, evidenceByteSize: true,
      gym: { select: { id: true, slug: true, name: true, city: true, country: true, ownerId: true } },
      claimant: { select: { id: true, name: true, username: true, email: true } },
    },
  });
  return NextResponse.json({ claims });
}

export const dynamic = "force-dynamic";
