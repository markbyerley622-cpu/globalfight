import "server-only";
import { ProviderConfigError, ProviderError } from "../ProviderError";
import type { SttProvider, TranscribeInput, TranscriptionResult } from "./SttProvider";

// Bounded timeout. Without one a hung provider holds the invocation open until the
// platform kills it, and the caller waits for nothing. 30s is generous for a short
// voice note.
const PROVIDER_TIMEOUT_MS = Number(process.env.VOICEBUILD_TIMEOUT_MS ?? "30000");


// Deepgram pre-recorded transcription via REST (no SDK needed). Model nova-3,
// smart_format on. Key is server-only; never logged, never returned.
export function deepgramSttProvider(): SttProvider {
  const key = process.env.DEEPGRAM_API_KEY;
  return {
    name: "deepgram",
    async transcribeAudio({ buffer, mimeType }: TranscribeInput): Promise<TranscriptionResult> {
      if (!key) throw new ProviderConfigError("stt", "deepgram", ["DEEPGRAM_API_KEY"]);

      const url = "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true";
      let res: Response;
      try {
        res = await fetch(url, {
          signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
          method: "POST",
          headers: {
            Authorization: `Token ${key}`,
            "Content-Type": mimeType || "audio/webm",
          },
          body: new Uint8Array(buffer),
        });
      } catch {
        throw new ProviderError("stt_network", "Could not reach the speech provider.");
      }
      if (!res.ok) {
        throw new ProviderError("stt_http", `Speech provider request failed (${res.status}).`);
      }

      const data = (await res.json()) as DeepgramResponse;
      const alt = data.results?.channels?.[0]?.alternatives?.[0];
      const words = alt?.words?.map((w) => ({
        text: w.punctuated_word ?? w.word,
        start: w.start,
        end: w.end,
        confidence: w.confidence,
      }));

      return {
        provider: "deepgram",
        transcript: (alt?.transcript ?? "").trim(),
        confidence: alt?.confidence,
        durationMs: data.metadata?.duration ? Math.round(data.metadata.duration * 1000) : undefined,
        language: data.results?.channels?.[0]?.detected_language,
        words,
        // `raw` intentionally omitted — sanitised before it leaves the server anyway.
      };
    },
  };
}

type DeepgramResponse = {
  metadata?: { duration?: number };
  results?: {
    channels?: Array<{
      detected_language?: string;
      alternatives?: Array<{
        transcript?: string;
        confidence?: number;
        words?: Array<{
          word: string;
          punctuated_word?: string;
          start?: number;
          end?: number;
          confidence?: number;
        }>;
      }>;
    }>;
  };
};
