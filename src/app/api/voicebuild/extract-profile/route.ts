import { getLlmProvider } from "@/lib/voicebuild/providers/providerConfig.server";
import { emptyProfile, type FighterProfile } from "@/lib/voicebuild/fighterProfileSchema";
import { guardVoicebuild, recordVoicebuildUse, deny } from "@/lib/voicebuild/guard.server";
import { log } from "@/lib/scraper/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A transcript is text, but it is still user data forwarded to a third-party LLM. */
const MAX_TRANSCRIPT_CHARS = 20_000;

export async function POST(req: Request) {
  const gate = await guardVoicebuild(req, { countsTowardQuota: true });
  if (!gate.ok) return gate.response;

  if (!req.headers.get("content-type")?.includes("application/json")) {
    return deny(415, "Unsupported request.");
  }

  try {
    const body = (await req.json()) as { transcript?: string; existingProfile?: FighterProfile };

    const transcript = typeof body.transcript === "string" ? body.transcript : "";
    if (!transcript.trim()) return deny(400, "No transcript provided.");
    // Bound what we forward to a paid provider.
    if (transcript.length > MAX_TRANSCRIPT_CHARS) return deny(413, "Transcript is too long.");

    const existingProfile = body.existingProfile ?? emptyProfile();

    const result = await getLlmProvider().extractFighterProfile({
      transcript,
      existingProfile,
      schemaName: "fighter_profile_extraction",
    });

    await recordVoicebuildUse(gate.user.id, { bytes: transcript.length, mime: "text/plain" });

    return Response.json({ ok: true, result }, { headers: { "cache-control": "private, no-store" } });
  } catch (err) {
    log.warn({ err: (err as Error).name }, "voicebuild:extract-failed");
    return deny(502, "Voice processing is temporarily unavailable.");
  }
}
