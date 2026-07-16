import { getSttProvider } from "@/lib/voicebuild/providers/providerConfig.server";
import { sanitizeTranscription } from "@/lib/voicebuild/providers/stt/SttProvider";
import { guardVoicebuild, recordVoicebuildUse, deny } from "@/lib/voicebuild/guard.server";
import { validateAudio, rejectsRemoteUrls, MAX_AUDIO_BYTES } from "@/lib/voicebuild/audio-validation";
import { log } from "@/lib/scraper/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Transcribe a recording. Authenticated, rate-limited and quota-bounded — see guard.server.ts. */
export async function POST(req: Request) {
  const gate = await guardVoicebuild(req, { countsTowardQuota: true });
  if (!gate.ok) return gate.response;

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_AUDIO_BYTES + 1024 * 1024) return deny(413, "The recording is too large.");

  try {
    const form = await req.formData();
    if (!rejectsRemoteUrls(form)) return deny(400, "Unsupported request.");

    const file = form.get("audio");
    if (!(file instanceof File)) return deny(400, "No audio file provided.");
    if (file.size > MAX_AUDIO_BYTES) return deny(413, "The recording is too large.");

    const buffer = Buffer.from(await file.arrayBuffer());
    const verdict = validateAudio(buffer, file.type, file.name);
    if (!verdict.ok) return deny(400, verdict.reason);

    const result = await getSttProvider().transcribeAudio({
      buffer,
      mimeType: verdict.mime,
      fileName: "recording",
    });

    await recordVoicebuildUse(gate.user.id, { bytes: buffer.length, mime: verdict.mime });

    return Response.json(
      { ok: true, result: sanitizeTranscription(result) },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    log.warn({ err: (err as Error).name }, "voicebuild:transcribe-failed");
    return deny(502, "Voice processing is temporarily unavailable.");
  }
}
