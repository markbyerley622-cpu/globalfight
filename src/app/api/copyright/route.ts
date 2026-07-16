import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { hit, clientIp, POLICY } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE = { "cache-control": "private, no-store" };

/**
 * Submit a copyright / takedown notice.
 *
 * Deliberately OPEN to anonymous callers. A rights owner is almost always a stranger
 * to the platform — Getty are not going to create an account to tell you their photo
 * is on your site. Requiring a login would make the takedown path useless. We
 * rate-limit by IP instead and require contact details.
 *
 * NOTE: recording notices is not the same as having a registered DMCA designated
 * agent. That is an external filing with the US Copyright Office and it has NOT been
 * done — see docs/EXTERNAL-COMPLIANCE-ACTIONS.md. Do not claim safe-harbour.
 */
export async function POST(req: Request) {
  const gate = await hit(`copyright:${clientIp(req)}`, POLICY.contentReport.limit, POLICY.contentReport.windowMs);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many reports. Try again shortly." },
      { status: 429, headers: { ...PRIVATE, "retry-after": String(gate.retryAfter) } },
    );
  }

  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Invalid request." }, { status: 415, headers: PRIVATE });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: PRIVATE }); }

  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");
  const bool = (k: string) => body[k] === true;

  const contentIdentifier = str("contentIdentifier");
  const reporterName = str("reporterName");
  const reporterEmail = str("reporterEmail");
  const workDescription = str("workDescription");
  const signature = str("signature");

  if (!contentIdentifier || !reporterName || !reporterEmail || !workDescription || !signature) {
    return NextResponse.json(
      { error: "Please complete every required field." },
      { status: 400, headers: PRIVATE },
    );
  }
  if (!reporterEmail.includes("@")) {
    return NextResponse.json({ error: "Enter a valid contact email." }, { status: 400, headers: PRIVATE });
  }

  // The two declarations are the substance of a takedown notice. Without them this is
  // just an opinion, and acting on it could expose us to the uploader.
  if (!bool("ownershipClaim") || !bool("goodFaithClaim")) {
    return NextResponse.json(
      { error: "Both declarations are required to submit a copyright notice." },
      { status: 400, headers: PRIVATE },
    );
  }

  const report = await prisma.copyrightReport.create({
    data: {
      contentIdentifier,
      contentUrl: str("contentUrl") || null,
      reporterName,
      reporterEmail,
      reporterOrg: str("reporterOrg") || null,
      workDescription,
      ownershipClaim: true,
      goodFaithClaim: true,
      signature,
      status: "RECEIVED",
    },
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: {
      actorId: (await getCurrentUser())?.id ?? null,
      action: "copyright.report.received",
      entity: "CopyrightReport",
      entityId: report.id,
      meta: { contentIdentifier },
    },
  }).catch(() => {});

  return NextResponse.json(
    {
      ok: true,
      reference: report.id,
      message: "Your notice has been received and will be reviewed.",
    },
    { status: 201, headers: PRIVATE },
  );
}
