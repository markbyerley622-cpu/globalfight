import "server-only";
import { NextResponse } from "next/server";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, ALLOWED_IMAGE_TYPES } from "./limits";

// ════════════════════════════════════════════════════════════════════════════
//  One upload policy, shared by every image endpoint.
//
//  The avatar route hand-rolled its own MAX_BYTES and ALLOWED list. A second
//  copy in the gym routes would be a third set of limits to keep in sync, and
//  the one that drifts is always the one that lets a 40 MB TIFF through.
//
//  Validation happens on the SERVER. The client mirrors these numbers for a
//  fast error message, but the client's copy is a courtesy — this is the check
//  that counts.
// ════════════════════════════════════════════════════════════════════════════

// Re-exported so server routes have one import; the numbers themselves live in
// limits.ts because the client needs them too.
export { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, ALLOWED_IMAGE_TYPES, IMAGE_ACCEPT } from "./limits";

export interface ValidatedFile {
  file: File;
  buffer: Buffer;
}

/**
 * Pull one image out of a multipart body and validate it.
 *
 * Returns a ready-to-send NextResponse on failure so every route rejects with
 * the same wording — an upload that fails differently depending on which page
 * you were on reads as a broken app rather than a rule.
 */
export async function readImageUpload(
  form: FormData,
  field = "file",
): Promise<{ ok: true; value: ValidatedFile } | { ok: false; response: NextResponse }> {
  const file = form.get(field);

  if (!(file instanceof File)) {
    return { ok: false, response: NextResponse.json({ error: "No file provided." }, { status: 400 }) };
  }
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Use a JPG, PNG, WebP or AVIF image." }, { status: 415 }),
    };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      response: NextResponse.json({ error: `Image must be under ${MAX_UPLOAD_MB} MB.` }, { status: 413 }),
    };
  }
  if (file.size === 0) {
    return { ok: false, response: NextResponse.json({ error: "That file is empty." }, { status: 400 }) };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Magic-byte check. `file.type` is supplied by the client and is trivially
  // spoofed; sharp would reject a non-image later anyway, but failing here
  // means we never hand an arbitrary blob to the decoder in the first place.
  if (!looksLikeImage(buffer)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "That file isn't a valid image." }, { status: 415 }),
    };
  }

  return { ok: true, value: { file, buffer } };
}

/**
 * A file can pass every signature check and still be undecodable — a real PNG
 * header followed by garbage, or a truncated upload. sharp throws on those, and
 * an unhandled throw is a 500 for what is really a bad request. Callers wrap
 * their processing in this so the user gets "that image is corrupt".
 */
export function isDecodeError(e: unknown): boolean {
  const m = (e as Error)?.message ?? "";
  return /unsupported image format|Input buffer|premature end|corrupt|VipsJpeg|VipsPng|bad seek|Input file/i.test(m);
}

/** JPEG / PNG / WebP / AVIF signatures. */
function looksLikeImage(b: Buffer): boolean {
  if (b.length < 12) return false;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true; // JPEG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true; // PNG
  const riff = b.subarray(0, 4).toString("ascii");
  const webp = b.subarray(8, 12).toString("ascii");
  if (riff === "RIFF" && webp === "WEBP") return true;
  if (b.subarray(4, 8).toString("ascii") === "ftyp") return true; // AVIF/HEIF family
  return false;
}
