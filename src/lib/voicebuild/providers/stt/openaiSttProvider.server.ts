import "server-only";
import { ProviderConfigError, ProviderError } from "../ProviderError";
import type { SttProvider, TranscribeInput, TranscriptionResult } from "./SttProvider";

// Bounded timeout. Without one a hung provider holds the invocation open until the
// platform kills it, and the caller waits for nothing. 30s is generous for a short
// voice note.
const PROVIDER_TIMEOUT_MS = Number(process.env.VOICEBUILD_TIMEOUT_MS ?? "30000");


// OpenAI transcription fallback (whisper-1 by default). Only used when
// STT_PROVIDER=openai. Key server-only.
export function openaiSttProvider(): SttProvider {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
  return {
    name: "openai",
    async transcribeAudio({ buffer, mimeType, fileName }: TranscribeInput): Promise<TranscriptionResult> {
      if (!key) throw new ProviderConfigError("stt", "openai", ["OPENAI_API_KEY"]);

      const fd = new FormData();
      const blob = new Blob([new Uint8Array(buffer)], { type: mimeType || "audio/webm" });
      fd.append("file", blob, fileName || "answer.webm");
      fd.append("model", model);
      fd.append("temperature", "0");

      let res: Response;
      try {
        res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body: fd,
        });
      } catch {
        throw new ProviderError("stt_network", "Could not reach the speech provider.");
      }
      if (!res.ok) {
        throw new ProviderError("stt_http", `Speech provider request failed (${res.status}).`);
      }
      const data = (await res.json()) as { text?: string; language?: string };
      return { provider: "openai", transcript: (data.text || "").trim(), language: data.language };
    },
  };
}
