import "server-only";
import { runFighterExtraction, type ChatMessage } from "../../extractors/fighterProfileExtractor.server";
import { ProviderConfigError, ProviderError } from "../ProviderError";
import type { LlmExtractionInput, LlmProvider } from "./LlmProvider";

// Bounded timeout. Without one a hung provider holds the invocation open until the
// platform kills it, and the caller waits for nothing. 30s is generous for a short
// voice note.
const PROVIDER_TIMEOUT_MS = Number(process.env.VOICEBUILD_TIMEOUT_MS ?? "30000");


// Grok / xAI extraction. xAI exposes an OpenAI-compatible Chat Completions API,
// so we use JSON-object output mode + server-side Zod validation + one repair
// retry (strict json_schema support is inconsistent across xAI models, so we do
// not rely on it). Key server-only.
export function xaiLlmProvider(): LlmProvider {
  const key = process.env.XAI_API_KEY;
  const base = (process.env.XAI_BASE_URL || "https://api.x.ai/v1").replace(/\/$/, "");
  const model = process.env.XAI_MODEL || "grok-4.3";

  return {
    name: "xai",
    model,
    async extractFighterProfile(input: LlmExtractionInput) {
      if (!key) throw new ProviderConfigError("llm", "xai", ["XAI_API_KEY"]);

      const complete = async (messages: ChatMessage[]) => {
        let res: Response;
        try {
          res = await fetch(`${base}/chat/completions`, {
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
