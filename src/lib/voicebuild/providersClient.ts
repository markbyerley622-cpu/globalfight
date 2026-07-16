"use client";

import type { FighterProfile } from "./fighterProfileSchema";
import type { FighterProfileExtractionResult } from "./schemas/extractionResultSchema";
import type { TranscriptionResult } from "./providers/stt/SttProvider";

// Client wrappers for the /api/onboarding endpoints. No keys, no OpenAI — audio
// only ever goes to our own server routes.

export type ProviderStatus = {
  stt: { provider: "deepgram" | "openai" | "mock"; configured: boolean; missing: string[] };
  llm: { provider: "xai" | "openai" | "mock"; configured: boolean; missing: string[]; model?: string };
  mock: { voice: boolean; llm: boolean };
};

export type ApiError = { ok: false; error: string; code?: string; hint?: string; missing?: string[] };

export type IntakeResponse =
  | {
      ok: true;
      transcript: string;
      transcription: TranscriptionResult;
      extraction: FighterProfileExtractionResult;
      missingRequiredFields: { fieldPath: string; label: string; reason: string }[];
      mergePreview: FighterProfile;
    }
  | ApiError;

export type ExtractResponse = { ok: true; result: FighterProfileExtractionResult } | ApiError;

export async function getProviderStatus(): Promise<ProviderStatus> {
  const res = await fetch("/api/voicebuild/provider-status", { cache: "no-store" });
  return res.json();
}

export async function intake(blob: Blob, existingProfile: FighterProfile): Promise<IntakeResponse> {
  const fd = new FormData();
  const ext = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm";
  fd.append("audio", blob, `intake.${ext}`);
  fd.append("existingProfile", JSON.stringify(existingProfile));
  const res = await fetch("/api/voicebuild/intake", { method: "POST", body: fd });
  return res.json();
}

export async function extractProfile(
  transcript: string,
  existingProfile: FighterProfile,
): Promise<ExtractResponse> {
  const res = await fetch("/api/voicebuild/extract-profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript, existingProfile }),
  });
  return res.json();
}
