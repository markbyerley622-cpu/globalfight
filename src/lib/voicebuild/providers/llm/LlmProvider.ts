// LLM provider contract (types only — safe to import anywhere).
import type { FighterProfile } from "../../fighterProfileSchema";
import type { FighterProfileExtractionResult } from "../../schemas/extractionResultSchema";

export type LlmProviderName = "xai" | "openai" | "mock";

export type LlmExtractionInput = {
  transcript: string;
  existingProfile: FighterProfile;
  schemaName: "fighter_profile_extraction";
};

export interface LlmProvider {
  readonly name: LlmProviderName;
  readonly model?: string;
  extractFighterProfile(input: LlmExtractionInput): Promise<FighterProfileExtractionResult>;
}

export type { FighterProfileExtractionResult };
