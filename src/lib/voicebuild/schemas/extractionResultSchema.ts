import { z } from "zod";
import {
  fightSchema,
  highlightSchema,
  sponsorSchema,
  type FighterProfile,
} from "../fighterProfileSchema";

// ---------------------------------------------------------------------------
// Strict validation for whatever the LLM returns. The model output is NEVER
// trusted directly — it must parse against these schemas before anything is
// merged into the profile. Numbers are coerced (a model may emit "5"); unknown
// top-level keys are stripped by Zod's default object behaviour.
// ---------------------------------------------------------------------------

const num = z.coerce.number().nonnegative();

// A validated PARTIAL of FighterProfile. `media` intentionally omits `gallery`
// (photos are only added in the upload step, never by the LLM).
export const fighterProfilePatchSchema = z
  .object({
    identity: z
      .object({
        fullName: z.string(),
        displayName: z.string(),
        nickname: z.string(),
        role: z.string(),
        tagline: z.string(),
      })
      .partial()
      .optional(),
    bio: z
      .object({ aboutHeadline: z.string(), aboutBody: z.string() })
      .partial()
      .optional(),
    vitals: z
      .object({
        division: z.string(),
        nationality: z.string(),
        residence: z.string(),
        birthplace: z.string(),
        age: num,
        dateOfBirth: z.string(),
        careerSpan: z.string(),
        debutDate: z.string(),
        bouts: num,
        rounds: num,
        koRate: z.string(),
        ranking: z.string(),
        fightingWeight: z.object({ value: num, unit: z.enum(["kg", "lb"]) }),
      })
      .partial()
      .optional(),
    record: z
      .object({
        wins: num,
        losses: num,
        draws: num,
        kos: num,
        fights: z.array(fightSchema),
      })
      .partial()
      .optional(),
    media: z
      .object({
        highlights: z.array(highlightSchema),
        mainHighlightsUrl: z.string(),
      })
      .partial()
      .optional(),
    socials: z
      .object({
        youtube: z.string(),
        instagram: z.string(),
        tiktok: z.string(),
        x: z.string(),
        facebook: z.string(),
        twitch: z.string(),
        threads: z.string(),
        linkedin: z.string(),
        snapchat: z.string(),
        website: z.string(),
      })
      .partial()
      .optional(),
    sponsors: z.array(sponsorSchema).optional(),
    contact: z
      .object({ businessEmail: z.string(), bookingUrlOrEmail: z.string() })
      .partial()
      .optional(),
  })
  .partial();

export type FighterProfilePatch = z.infer<typeof fighterProfilePatchSchema>;

export const fieldExtractionSchema = z.object({
  fieldPath: z.string(),
  rawEvidence: z.string(),
  value: z.unknown(),
  confidence: z.enum(["high", "medium", "low"]),
  needsReview: z.boolean(),
  reviewReason: z.string().optional(),
});

export const extractionResultSchema = z.object({
  transcript: z.string(),
  extractedProfilePatch: fighterProfilePatchSchema,
  fieldExtractions: z.array(fieldExtractionSchema),
  missingRequiredFields: z.array(
    z.object({ fieldPath: z.string(), label: z.string(), reason: z.string() }),
  ),
  ambiguousFields: z.array(
    z.object({ fieldPath: z.string(), candidates: z.array(z.unknown()), reason: z.string() }),
  ),
  ignoredStatements: z.array(z.string()),
});

export type FighterProfileExtractionResult = z.infer<typeof extractionResultSchema>;

// Re-exported for provider interface typing.
export type { FighterProfile };
