// Typed, user-safe provider errors. Messages here are already sanitised for
// end users — they never contain keys, hostnames or raw upstream payloads.

export type ProviderKind = "stt" | "llm";

export class ProviderConfigError extends Error {
  readonly code = "provider_not_configured";
  constructor(
    public kind: ProviderKind,
    public provider: string,
    public missing: string[],
  ) {
    super(
      kind === "stt"
        ? "Speech provider is not configured."
        : "Extraction provider is not configured.",
    );
    this.name = "ProviderConfigError";
  }
}

export class ProviderError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export const CONFIG_HINT = "Add the missing key to .env.local or enable mock mode.";
