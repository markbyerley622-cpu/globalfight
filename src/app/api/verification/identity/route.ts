import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  submitVerification, myVerifications, canSubmit,
  MAX_EVIDENCE_BYTES, type DocumentKind, type UploadInput,
} from "@/lib/identity-verification";
import { hit, clientIp, POLICY } from "@/lib/rate-limit";
import { log } from "@/lib/scraper/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: DocumentKind[] = ["FRONT", "BACK", "SUPPORTING"];

/**
 * The signed-in user's own verification history. Never includes storage keys.
 *
 * Explicitly `private, no-store`. The response is per-user and describes an
 * identity check — who submitted, when, what a reviewer said — and it carried NO
 * cache-control header at all, verified against production. `dynamic =
 * "force-dynamic"` stops NEXT caching it; it says nothing to a CDN, a corporate
 * proxy or the browser's own disk cache, any of which could then hand one
 * person's verification state to the next request on a shared connection.
 * Stating it is one header; assuming it is a shared-cache bug.
 */
const PRIVATE_NO_STORE = {
  "cache-control": "private, no-store, max-age=0, must-revalidate",
} as const;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401, headers: PRIVATE_NO_STORE });
  }

  const [history, eligibility] = await Promise.all([myVerifications(user.id), canSubmit(user.id)]);
  return NextResponse.json(
    { history, canSubmit: eligibility.allowed, reason: eligibility.reason ?? null },
    { headers: PRIVATE_NO_STORE },
  );
}

/**
 * Submit identity documents for review.
 *
 * Multipart, because these are files. Every authorisation and validation
 * decision is made HERE, on the server, from the session — nothing about which
 * user this is, which role they hold, or whether they are allowed to submit
 * comes from the request body.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const gate = await hit(
    `identity-submit:${user.id}`,
    POLICY.evidenceUpload.limit,
    POLICY.evidenceUpload.windowMs,
  );
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many uploads. Try again later." },
      { status: 429, headers: { "retry-after": String(gate.retryAfter) } },
    );
  }

  if (!req.headers.get("content-type")?.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Upload the documents as a form." }, { status: 415 });
  }

  // Re-checked inside submitVerification too. This copy exists to reject early
  // with a useful message rather than after reading megabytes off the wire.
  const eligible = await canSubmit(user.id);
  if (!eligible.allowed) return NextResponse.json({ error: eligible.reason }, { status: 409 });

  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ error: "Could not read the upload." }, { status: 400 }); }

  const uploads: UploadInput[] = [];
  for (const kind of KINDS) {
    const entry = form.get(kind.toLowerCase());
    if (!entry || typeof entry === "string") continue;
    const file = entry as File;
    if (file.size === 0) continue;
    if (file.size > MAX_EVIDENCE_BYTES) {
      return NextResponse.json(
        { error: `${kind} is larger than ${Math.floor(MAX_EVIDENCE_BYTES / 1024 / 1024)}MB.` },
        { status: 413 },
      );
    }
    uploads.push({
      kind,
      bytes: Buffer.from(await file.arrayBuffer()),
      declaredMime: file.type || "application/octet-stream",
    });
  }

  const hasFront = uploads.some((u) => u.kind === "FRONT");
  if (!hasFront) return NextResponse.json({ error: "The front of your ID is required." }, { status: 400 });

  const result = await submitVerification(user.id, uploads);
  if (!result.ok) {
    const status = result.reason === "BAD_FILE" ? 400 : result.reason === "NO_DOCUMENTS" ? 400 : 409;
    const message: Record<string, string> = {
      NOT_PROFESSIONAL: "Only professional roles need identity verification.",
      ALREADY_PENDING: "You already have a review in progress.",
      ALREADY_VERIFIED: "You're already verified.",
      NO_DOCUMENTS: "Attach at least the front of your ID.",
      BAD_FILE: result.detail ?? "That file could not be accepted.",
    };
    // Never log the bytes, the storage key or the filename.
    log.warn({ userId: user.id, reason: result.reason }, "identity:submit-rejected");
    return NextResponse.json({ error: message[result.reason] }, { status });
  }

  log.info({ userId: user.id, attempt: result.attempt, ip: clientIp(req) }, "identity:submitted");
  return NextResponse.json({ ok: true, id: result.verificationId, attempt: result.attempt }, { status: 201 });
}
