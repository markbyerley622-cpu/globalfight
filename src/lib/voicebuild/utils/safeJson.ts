// Tolerant JSON extraction for LLM output (may be fenced or have prose around
// it). Pure — safe to import anywhere.

export type ParseResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** Pull the first balanced JSON object out of a possibly-fenced string. */
export function extractJsonBlock(text: string): string | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return body.slice(start, end + 1);
}

export function safeJsonParse<T = unknown>(text: string): ParseResult<T> {
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid JSON" };
  }
}

/** Extract + parse in one step. */
export function parseLooseJson<T = unknown>(text: string): ParseResult<T> {
  const block = extractJsonBlock(text);
  if (!block) return { ok: false, error: "No JSON object found in output." };
  return safeJsonParse<T>(block);
}
