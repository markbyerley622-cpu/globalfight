import "server-only";
import { runFighterExtraction, type ChatMessage } from "../../extractors/fighterProfileExtractor.server";
import { ProviderConfigError, ProviderError } from "../ProviderError";
import type { LlmExtractionInput, LlmProvider } from "./LlmProvider";

// Bounded timeout. Without one a hung provider holds the invocation open until the
// platform kills it, and the caller waits for nothing. 30s is generous for a short
// voice note.
const PROVIDER_TIMEOUT_MS = Number(process.env.VOICEBUILD_TIMEOUT_MS ?? "30000");


// OpenAI extraction fallback (only used when LLM_PROVIDER=openai). Same shared
// extractor + validation path as xAI, using JSON-object output mode. Key
// server-only.
export function openaiLlmProvider(): LlmProvider {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_EXTRACT_MODEL || "gpt-4o-mini";

  return {
    name: "openai",
    model,
    async extractFighterProfile(input: LlmExtractionInput) {
      if (!key) throw new ProviderConfigError("llm", "openai", ["OPENAI_API_KEY"]);

      const complete = async (messages: ChatMessage[]) => {
        let res: Response;
        try {
          res = await fetch("https://api.openai.com/v1/chat/completions", {
          signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              temperature: 0,
              response_format: { type: "json_object" },
              messages,
            }),
          });
        } catch {
          throw new ProviderError("llm_network", "Could not reach the extraction provider.");
        }
        if (!res.ok) {
          throw new ProviderError("llm_http", `Extraction provider request failed (${res.status}).`);
        }
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        return data.choices?.[0]?.message?.content ?? "";
      };

      return runFighterExtraction(input, complete);
    },
  };
}
