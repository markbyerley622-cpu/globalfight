import "server-only";
import { flag, missingFrom, present, value } from "../utils/envStatus.server";
import { deepgramSttProvider } from "./stt/deepgramSttProvider.server";
import { openaiSttProvider } from "./stt/openaiSttProvider.server";
import { mockSttProvider } from "./stt/mockSttProvider.server";
import { xaiLlmProvider } from "./llm/xaiLlmProvider.server";
import { openaiLlmProvider } from "./llm/openaiLlmProvider.server";
import { mockLlmProvider } from "./llm/mockLlmProvider.server";
import type { SttProvider, SttProviderName } from "./stt/SttProvider";
import type { LlmProvider, LlmProviderName } from "./llm/LlmProvider";

// Central provider selection. STT_PROVIDER controls transcription only;
// LLM_PROVIDER controls extraction only. Mock flags/short-circuits win so the
// app is fully usable with zero keys.

function sttName(): SttProviderName {
  if (flag("ENABLE_MOCK_VOICE") || value("STT_PROVIDER") === "mock") return "mock";
  return value("STT_PROVIDER", "deepgram") === "openai" ? "openai" : "deepgram";
}

function llmName(): LlmProviderName {
  if (flag("ENABLE_MOCK_LLM") || value("LLM_PROVIDER") === "mock") return "mock";
  return value("LLM_PROVIDER", "xai") === "openai" ? "openai" : "xai";
}

export function getSttProvider(): SttProvider {
  switch (sttName()) {
    case "mock":
      return mockSttProvider();
    case "openai":
      return openaiSttProvider();
    default:
      return deepgramSttProvider();
  }
}

export function getLlmProvider(): LlmProvider {
  switch (llmName()) {
    case "mock":
      return mockLlmProvider();
    case "openai":
      return openaiLlmProvider();
    default:
      return xaiLlmProvider();
  }
}

export type ProviderStatus = {
  stt: { provider: SttProviderName; configured: boolean; missing: string[] };
  llm: { provider: LlmProviderName; configured: boolean; missing: string[]; model?: string };
  mock: { voice: boolean; llm: boolean };
};

// Presence-only status — never returns key values.
export function getProviderStatus(): ProviderStatus {
  const s = sttName();
  const l = llmName();

  const sttMissing =
    s === "mock" ? [] : s === "openai" ? missingFrom(["OPENAI_API_KEY"]) : missingFrom(["DEEPGRAM_API_KEY"]);
  const llmMissing =
    l === "mock" ? [] : l === "openai" ? missingFrom(["OPENAI_API_KEY"]) : missingFrom(["XAI_API_KEY"]);

  return {
    stt: { provider: s, configured: sttMissing.length === 0, missing: sttMissing },
    llm: {
      provider: l,
      configured: llmMissing.length === 0,
      missing: llmMissing,
      model: l === "mock" ? "mock" : l === "openai" ? value("OPENAI_EXTRACT_MODEL", "gpt-4o-mini") : value("XAI_MODEL", "grok-4.3"),
    },
    mock: { voice: s === "mock", llm: l === "mock" },
  };
}

// Presence checks used by tests without touching provider internals.
export function keyPresent(name: string): boolean {
  return present(name);
}
