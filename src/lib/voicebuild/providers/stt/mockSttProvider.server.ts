import "server-only";
import { SAMPLE_TRANSCRIPT } from "../../fixtures/sampleFighter";
import type { SttProvider, TranscriptionResult } from "./SttProvider";

// Mock transcription — returns a realistic fighter transcript so the whole UI
// can be exercised with no keys and no audio actually being sent anywhere.
export function mockSttProvider(): SttProvider {
  return {
    name: "mock",
    async transcribeAudio(): Promise<TranscriptionResult> {
      return {
        provider: "mock",
        transcript: SAMPLE_TRANSCRIPT,
        confidence: 0.99,
        durationMs: 24000,
        language: "en",
      };
    },
  };
}
