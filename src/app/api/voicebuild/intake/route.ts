import { getLlmProvider, getSttProvider } from "@/lib/voicebuild/providers/providerConfig.server";
import { sanitizeTranscription } from "@/lib/voicebuild/providers/stt/SttProvider";
import { emptyProfile, type FighterProfile } from "@/lib/voicebuild/fighterProfileSchema";
import { mergePatch, missingRequired } from "@/lib/voicebuild/profileReducer";
import { guardVoicebuild, recordVoicebuildUse, deny } from "@/lib/voicebuild/guard.server";
import { validateAudio, rejectsRemoteUrls, MAX_AUDIO_BYTES } from "@/lib/voicebuild/audio-validation";
import { log } from "@/lib/scraper/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE = { "cache-control": "private, no-store" };

/**
 * Combined intake: audio → STT → LLM extraction → validated merge preview.
 *
 * SECURITY: this route was previously ANONYMOUS. It read `req.formData()` and
 * shipped the bytes straight to Deepgram/OpenAI/xAI on the operator's keys, with
 * no session, no rate limit and no quota.
 *
 * The guard now runs BEFORE the body is touched, so a rejected request costs zero
 * provider calls and never buffers a stranger's audio into memory.
 */
export async function POST(req: Request) {
  const gate = await guardVoicebuild(req, { countsTowardQuota: true });
  if (!gate.ok) return gate.response;

  // Cheap pre-read rejection: refuse an oversized body before buffering it.
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_AUDIO_BYTES + 1024 * 1024) {
    return deny(413, "The recording is too large.");
  }

  try {
    const form = await req.formData();

    // Uploaded bytes only. A caller-supplied URL would be fetched server-side —
    // textbook SSRF. We reject rather than fetch.
    if (!rejectsRemoteUrls(form)) return deny(400, "Unsupported request.");

    const file = form.get("audio");
    if (!(file instanceof File)) return deny(400, "No audio file provided.");
    if (file.size > MAX_AUDIO_BYTES) return deny(413, "The recording is too large.");

    const buffer = Buffer.from(await file.arrayBuffer());
    const verdict = validateAudio(buffer, file.type, file.name);
    if (!verdict.ok) return deny(400, verdict.reason);

    const existingRaw = form.get("existingProfile");
    let existingProfile: FighterProfile = emptyProfile();
    if (typeof existingRaw === "string" && existingRaw) {
      try {
        existingProfile = { ...emptyProfile(), ...(JSON.parse(existingRaw) as FighterProfile) };
      } catch {
        /* fall back to empty */
      }
    }

    const transcription = await getSttProvider().transcribeAudio({
      buffer,
      mimeType: verdict.mime,
      fileName: "recording",   // never echo a user-supplied filename to a provider
    });

    const extraction = await getLlmProvider().extractFighterProfile({
      transcript: transcription.transcript,
      existingProfile,
      schemaName: "fighter_profile_extraction",
    });

    const mergePreview = mergePatch(existingProfile, extraction.extractedProfilePatch);
    const missingRequiredFields = missingRequired(mergePreview).map((m) => ({
      fieldPath: m.path,
      label: m.label,
      reason: "Required field is empty.",
    }));

    // Metadata only — never the audio, transcript, or extracted profile.
    await recordVoicebuildUse(gate.user.id, { bytes: buffer.length, mime: verdict.mime });

    return Response.json(
      {
        ok: true,
        transcript: transcription.transcript,
        transcription: sanitizeTranscription(transcription),
        extraction,
        missingRequiredFields,
        mergePreview,
      },
      { headers: PRIVATE },
    );
  } catch (err) {
    // Never return a raw provider error to the browser: it can name the provider,
    // echo the prompt, or carry a request id useful to an attacker. Log the class
    // of failure only — no transcript, no key, no body.
    log.warn({ err: (err as Error).name }, "voicebuild:intake-failed");
    return deny(502, "Voice processing is temporarily unavailable.");
  }
}
