import "server-only";
import type { ExtractionResult, ProfileField, Question } from "./questionBank";

// ---------------------------------------------------------------------------
// SERVER ONLY. Talks to OpenAI over fetch (no SDK dependency). The API key is
// read from process.env and never leaves the server. Transcription uses the
// audio endpoint; extraction uses Chat Completions with a STRICT json_schema
// built from the current question, temperature 0 — deterministic, field-scoped,
// no free-form output, no invented facts.
// ---------------------------------------------------------------------------

const OPENAI = "https://api.openai.com/v1";

function key(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k) {
    // Sanitised message — never surface the raw env-var name to the user.
    throw new Error("Provider is not configured. Add the missing key to .env.local or enable mock mode.");
  }
  return k;
}

export async function transcribeAudio(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file, file.name || "answer.webm");
  fd.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1");
  fd.append("temperature", "0");
  const res = await fetch(`${OPENAI}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}` },
    body: fd,
  });
  if (!res.ok) {
    throw new Error(`Transcription failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { text?: string };
  return (data.text || "").trim();
}

// Map a field type to a nullable JSON-schema leaf (null = "not stated").
function leaf(field: ProfileField): Record<string, unknown> {
  if (field.type === "number") return { type: ["number", "null"] };
  return { type: ["string", "null"] };
}

// Build a STRICT extraction schema from the question's declared fields only.
function buildSchema(question: Question) {
  const properties: Record<string, unknown> = {};
  for (const f of question.fields) {
    if (f.type === "array") {
      const itemProps: Record<string, unknown> = {};
      const itemKeys: string[] = [];
      for (const it of f.itemFields ?? []) {
        itemProps[it.id] = leaf(it);
        itemKeys.push(it.id);
      }
      properties[f.id] = {
        type: ["array", "null"],
        items: {
          type: "object",
          additionalProperties: false,
          properties: itemProps,
          required: itemKeys,
        },
      };
    } else {
      properties[f.id] = leaf(f);
    }
  }
  return {
    name: "fighter_extraction",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        extracted: {
          type: "object",
          additionalProperties: false,
          properties,
          required: question.fields.map((f) => f.id),
        },
        needsReview: { type: "boolean" },
        reviewReason: { type: ["string", "null"] },
      },
      required: ["extracted", "needsReview", "reviewReason"],
    },
  };
}

const SYSTEM = [
  "You extract structured fighter-profile data from a spoken answer.",
  "Rules:",
  "- Only populate the fields provided in the schema. Never add other fields.",
  "- Use ONLY information explicitly present in the transcript. Never invent, guess, or infer facts that were not said.",
  "- If a field was not clearly stated, return null for it.",
  "- Numbers must be plain numbers (e.g. 5), not words.",
  "- If the answer is empty, off-topic, or too unclear to map confidently, set needsReview=true and give a short reviewReason.",
  "- Otherwise needsReview=false and reviewReason=null.",
  "- Be deterministic and literal.",
].join("\n");

export async function extractStructured(
  question: Question,
  transcript: string,
): Promise<ExtractionResult> {
  const base: ExtractionResult = {
    questionId: question.id,
    targetFields: question.fields.map((f) => f.id),
    transcript,
    extracted: {},
    needsReview: false,
  };

  if (!transcript.trim()) {
    return { ...base, needsReview: true, reviewReason: "Empty transcript." };
  }

  const body = {
    model: process.env.OPENAI_EXTRACT_MODEL || "gpt-4o-mini",
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content:
          `Question: ${question.title}\n` +
          `Target fields: ${question.fields.map((f) => f.id).join(", ")}\n` +
          `Transcript: """${transcript}"""`,
      },
    ],
    response_format: { type: "json_schema", json_schema: buildSchema(question) },
  };

  const res = await fetch(`${OPENAI}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Extraction failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return { ...base, needsReview: true, reviewReason: "No model output." };

  let parsed: { extracted?: Record<string, unknown>; needsReview?: boolean; reviewReason?: string | null };
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ...base, needsReview: true, reviewReason: "Malformed model output." };
  }

  return {
    ...base,
    extracted: parsed.extracted ?? {},
    needsReview: Boolean(parsed.needsReview),
    reviewReason: parsed.reviewReason ?? undefined,
  };
}
