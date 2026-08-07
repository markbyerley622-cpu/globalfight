import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { enforceLimit } from "@/lib/rate-limit/guard";
import { POLICY } from "@/lib/rate-limit";
import { extractFromImage, extractFromText, isOcrConfigured } from "@/lib/promoter/poster/ocr";
import { parsePoster } from "@/lib/promoter/poster/parse";
import { toEditableDraft } from "@/lib/promoter/draft";
import { getViewerPromoter } from "@/lib/promoter/repo";
import { promoterCapabilities } from "@/lib/promoter/verification";
import { MAX_UPLOAD_BYTES, ALLOWED_IMAGE_TYPES } from "@/lib/images/limits";

/**
 * Read a poster (or pasted text) into an editable event draft.
 *
 * ── Access-control walk (CLAUDE.md rules 1–8) ───────────────────────────────
 * 1. Authenticated first — 401 before any work.
 * 2. The CAPABILITY check is the service layer's (`getViewerPromoter` +
 *    `promoterCapabilities`), so it holds for every caller rather than this one
 *    HTTP path. Extraction is gated on `uploadPoster`, which only VERIFIED has.
 * 3. Nothing is mass-assigned: the response is built from the parser's own
 *    output, and no request field reaches a database column.
 * 4/5. THIS ROUTE WRITES NOTHING. Extraction is pure — the draft lives in the
 *    client until the promoter presses Publish, which is a separate endpoint
 *    with its own transaction. That is deliberate: it means a promoter can
 *    re-read a poster, undo, and abandon a draft without leaving rows behind,
 *    and it is why the review screen can be instant.
 * 8. Non-GET and JSON/multipart only, so a cross-site form post cannot reach it.
 *
 * Rate-limited under the upload ceiling: extraction is the most expensive thing
 * a promoter can trigger, and with a provider configured it costs money per
 * call.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to host an event." }, { status: 401 });

  const promoter = await getViewerPromoter(user.id);
  if (!promoter || !promoterCapabilities(promoter.state).uploadPoster) {
    return NextResponse.json(
      { error: "Your promoter account isn't set up to do that yet." },
      { status: 403 },
    );
  }

  // mediaUpload, not `interaction`: with a provider configured, extraction runs
  // a paid third-party call per request, so it belongs on the ceiling that
  // already governs expensive per-file work.
  const limited = await enforceLimit(req, "promoter-poster", POLICY.mediaUpload, user.id);
  if (limited) return limited;

  const contentType = req.headers.get("content-type") ?? "";
  const now = new Date();

  // ── Pasted text ────────────────────────────────────────────────────────
  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as { text?: string };
    const outcome = extractFromText(String(body.text ?? "").slice(0, 20_000));
    if (outcome.status !== "OK") {
      return NextResponse.json({ error: outcome.reason }, { status: 422 });
    }
    return NextResponse.json({ draft: serialise(parsePoster(outcome.result.lines, now)) });
  }

  // ── An image ───────────────────────────────────────────────────────────
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No poster was sent." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That image is too large." }, { status: 413 });
  }
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return NextResponse.json({ error: "Upload a PNG, JPEG or WebP." }, { status: 415 });
  }

  const outcome = await extractFromImage(Buffer.from(await file.arrayBuffer()), file.type);
  if (outcome.status !== "OK") {
    // 422, not 500, even for UNAVAILABLE: nothing is broken, we simply cannot
    // read it here. The client offers the paste path, and `ocrConfigured` tells
    // it whether retrying could ever help.
    return NextResponse.json(
      { error: outcome.reason, ocrConfigured: isOcrConfigured() },
      { status: 422 },
    );
  }

  return NextResponse.json({ draft: serialise(parsePoster(outcome.result.lines, now)) });
}

/** A Set does not survive JSON — the client rehydrates it. */
function serialise(poster: ReturnType<typeof parsePoster>) {
  const draft = toEditableDraft(poster);
  return { ...draft, uncertainFields: [...draft.uncertainFields] };
}

export const dynamic = "force-dynamic";
