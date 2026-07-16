import "server-only";
import {
  extractionResultSchema,
  type FighterProfileExtractionResult,
} from "../schemas/extractionResultSchema";
import { CANONICAL_PROFILE_FIELDS, FIELD_INTENT_ALIASES } from "../profileFields";
import { parseLooseJson } from "../utils/safeJson";
import { ProviderError } from "../providers/ProviderError";
import type { LlmExtractionInput } from "../providers/llm/LlmProvider";

// ---------------------------------------------------------------------------
// Shared extraction logic. Real providers (xAI, OpenAI) just supply a
// `complete(messages)` transport; this module owns the deterministic prompt,
// Zod validation, and a single repair retry. Nothing is returned unless it
// parses against extractionResultSchema — invalid/unvalidated JSON is rejected.
// ---------------------------------------------------------------------------

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type CompleteFn = (messages: ChatMessage[]) => Promise<string>;

const ALLOWED_PATHS = Object.keys(CANONICAL_PROFILE_FIELDS)
  .filter((p) => !p.startsWith("vitals.fightingWeight"))
  .concat("vitals.fightingWeight");

const INTENT_LINES = Object.entries(FIELD_INTENT_ALIASES).map(
  ([path, aliases]) => `  ${path} <= ${aliases.map((a) => `"${a}"`).join(", ")}`,
);

const SYSTEM = [
  "You are an INTENT PARSER for fighter-profile data — not a creative writer.",
  "Read the spoken transcript and map phrases to canonical fields. Return ONLY a single JSON object, no prose:",
  "{",
  '  "transcript": string,',
  '  "extractedProfilePatch": object (a PARTIAL FighterProfile; omit anything not clearly stated),',
  '  "fieldExtractions": [{ "fieldPath": string, "rawEvidence": string, "value": any, "confidence": "high"|"medium"|"low", "needsReview": boolean, "reviewReason"?: string }],',
  '  "missingRequiredFields": [{ "fieldPath": string, "label": string, "reason": string }],',
  '  "ambiguousFields": [{ "fieldPath": string, "candidates": any[], "reason": string }],',
  '  "ignoredStatements": string[]',
  "}",
  "",
  `Canonical field paths (use these EXACTLY, no others): ${ALLOWED_PATHS.join(", ")}.`,
  "record.fights[] items: {date?, opponent, result, method?, round?, location?}.",
  "media.highlights[] items: {title, url}. sponsors[] items: {name, url?}.",
  'vitals.fightingWeight: {value: number, unit: "kg" | "lb"}.',
  "",
  "INTENT ALIASES (spoken phrase => field):",
  ...INTENT_LINES,
  "",
  "RULES:",
  "- Provide rawEvidence (the exact transcript phrase) for EVERY fieldExtraction.",
  "- Extract ONLY what the transcript explicitly supports. Return nothing for unsupported fields. NEVER invent emails, URLs, handles, sponsors or stats.",
  "- PLACEHOLDER / NONSENSE: if a value is obvious filler (\"blah blah blah\", \"unknown\", \"not sure\", \"whatever\", \"none\", profanity, or clearly not a real value), DO NOT put it in extractedProfilePatch. Add it to fieldExtractions with needsReview=true and a reviewReason, or to ignoredStatements.",
  "- EMAIL: only set contact.businessEmail if it is a real email-shaped address (name@domain.tld). Spoken digits/words that are not an email (e.g. \"o one two one do one\") are NOT an email — needsReview, do not apply.",
  "- URLS / SOCIALS: only set a social/website/booking field if it is a plausible URL or handle. Vague text is not a handle — needsReview, do not apply.",
  "- WEIGHT: set vitals.fightingWeight only with a numeric value AND a unit (\"76 kilos\"->{value:76,unit:kg}, \"168 pounds\"->{value:168,unit:lb}). No clear unit, or implausible values -> needsReview, do not apply. Stone is unsupported -> needsReview. Never derive division from weight.",
  "- DIVISION: capture a stated division in vitals.division; it is independent of fightingWeight.",
  "- RECORD: only set record.wins/losses/draws/kos from a CLEARLY LABELLED phrase (e.g. \"10 wins, 2 losses, 1 draw, 7 KOs\"). A bare run of numbers with no labels (e.g. \"ten ten ten ten ten\", or five+ numbers) is AMBIGUOUS -> put in ambiguousFields, do NOT put in the patch.",
  "- NATIONALITY: only set vitals.nationality if the transcript EXPLICITLY states it (\"I am English\", \"my nationality is English\", \"I represent England\"). Do NOT infer nationality from residence or birthplace. If only residence/birthplace are given, leave nationality empty.",
  "- DATES: vitals.debutDate/careerSpan/dateOfBirth must be real dates/years. Vague or implausible periods (e.g. \"one hundred years ago\") -> needsReview or ambiguousFields, do not apply.",
  "- STATS: wins/losses/draws/kos/bouts/rounds must be non-negative integers. Absurd values (e.g. 1,000,000 bouts) -> needsReview, do not apply.",
  "- ARRAYS: never output empty or partial rows. A fight needs an opponent plus a date/result/method/location; a highlight needs a title or URL; a sponsor needs a name. Omit rows that don't meet this.",
  "- CONTROLLED FIELDS: identity.role, vitals.fightingWeight, vitals.nationality are user-set. If the CURRENT PROFILE already has one, keep it — only include a different value if the transcript EXPLICITLY corrects it; on conflict add to ambiguousFields instead of overwriting.",
  "- Latest explicit correction wins. If two values conflict with no correction, use ambiguousFields and leave it out of the patch.",
  "- Never fill media.gallery — photos are added separately.",
  "- Be deterministic and literal.",
].join("\n");

function buildUserPrompt(input: LlmExtractionInput): string {
  return [
    "TRANSCRIPT:",
    `"""${input.transcript}"""`,
    "",
    "CURRENT PROFILE (for context — do not repeat unchanged values, only extract what the transcript states):",
    JSON.stringify(input.existingProfile),
    "",
    'Return the JSON object now. Always include the "transcript" field set to the transcript above.',
  ].join("\n");
}

function validate(text: string):
  | { ok: true; value: FighterProfileExtractionResult }
  | { ok: false; error: string } {
  const parsed = parseLooseJson(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const result = extractionResultSchema.safeParse(parsed.value);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  return { ok: true, value: result.data };
}

export async function runFighterExtraction(
  input: LlmExtractionInput,
  complete: CompleteFn,
): Promise<FighterProfileExtractionResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: buildUserPrompt(input) },
  ];

  const first = await complete(messages);
  let check = validate(first);

  // One repair retry: hand the model its own output + the validation error.
  if (!check.ok) {
    const repair = await complete([
      ...messages,
      { role: "assistant", content: first },
      {
        role: "user",
        content: `That JSON was invalid (${check.error}). Return ONLY corrected JSON matching the required shape.`,
      },
    ]);
    check = validate(repair);
  }

  if (!check.ok) {
    throw new ProviderError(
      "extraction_invalid",
      "The extraction provider returned data we could not validate.",
    );
  }

  // Guarantee the transcript field reflects the real transcript.
  return { ...check.value, transcript: check.value.transcript || input.transcript };
}
