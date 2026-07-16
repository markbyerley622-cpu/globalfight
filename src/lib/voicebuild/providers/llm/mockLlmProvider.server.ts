import "server-only";
import { sampleExtraction } from "../../fixtures/sampleFighter";
import { extractionResultSchema } from "../../schemas/extractionResultSchema";
import type { LlmExtractionInput, LlmProvider } from "./LlmProvider";

// Mock extraction — returns a canned, schema-valid FighterProfileExtractionResult
// (validated on the way out, exactly like a real provider) so the confirm/merge
// UI is fully testable with no keys.
export function mockLlmProvider(): LlmProvider {
  return {
    name: "mock",
    model: "mock",
    async extractFighterProfile({ transcript }: LlmExtractionInput) {
      return extractionResultSchema.parse(sampleExtraction(transcript || ""));
    },
  };
}
