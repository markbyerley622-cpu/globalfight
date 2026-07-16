import type { FighterProfileExtractionResult } from "../schemas/extractionResultSchema";

// Deterministic sample used by the mock providers and the "Test with mock
// transcript" button. Kept in sync with sample-fighter-transcript.txt.
export const SAMPLE_TRANSCRIPT =
  "My fighter's full name is Daniel James Vega. Display name is Danny Vega. " +
  "His nickname is The Hammer. He's a professional boxer. Tagline: iron will, iron fists. " +
  "Division is light heavyweight. He's Irish, born in Cork, and now lives in Dublin. " +
  "He's 29 years old and turned pro in March 2021, so career 2021 to ongoing. " +
  "His record is 14 wins, 2 losses, 1 draw, with 11 knockouts. " +
  "Business enquiries email is danny@vegaboxing.com. Instagram handle is at dannyvega.";

export function sampleExtraction(transcript: string): FighterProfileExtractionResult {
  return {
    transcript,
    extractedProfilePatch: {
      identity: {
        fullName: "Daniel James Vega",
        displayName: "Danny Vega",
        nickname: "The Hammer",
        role: "Professional Boxer",
        tagline: "Iron will, iron fists.",
      },
      vitals: {
        division: "Light Heavyweight",
        nationality: "Ireland",
        residence: "Dublin",
        birthplace: "Cork",
        age: 29,
        debutDate: "March 2021",
        careerSpan: "2021–Ongoing",
      },
      record: { wins: 14, losses: 2, draws: 1, kos: 11 },
      contact: { businessEmail: "danny@vegaboxing.com" },
    },
    fieldExtractions: [
      { fieldPath: "identity.fullName", rawEvidence: "full name is Daniel James Vega", value: "Daniel James Vega", confidence: "high", needsReview: false },
      { fieldPath: "identity.displayName", rawEvidence: "Display name is Danny Vega", value: "Danny Vega", confidence: "high", needsReview: false },
      { fieldPath: "identity.nickname", rawEvidence: "nickname is The Hammer", value: "The Hammer", confidence: "high", needsReview: false },
      { fieldPath: "vitals.division", rawEvidence: "Division is light heavyweight", value: "Light Heavyweight", confidence: "high", needsReview: false },
      { fieldPath: "record.wins", rawEvidence: "14 wins", value: 14, confidence: "high", needsReview: false },
      { fieldPath: "record.kos", rawEvidence: "11 knockouts", value: 11, confidence: "high", needsReview: false },
      { fieldPath: "contact.businessEmail", rawEvidence: "danny@vegaboxing.com", value: "danny@vegaboxing.com", confidence: "high", needsReview: false },
      { fieldPath: "socials.instagram", rawEvidence: "Instagram handle is at dannyvega", value: "@dannyvega", confidence: "medium", needsReview: true, reviewReason: "Handle given without a full URL." },
    ],
    missingRequiredFields: [],
    ambiguousFields: [],
    ignoredStatements: [],
  };
}
