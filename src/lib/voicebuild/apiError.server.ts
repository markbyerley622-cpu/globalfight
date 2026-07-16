import "server-only";
import { CONFIG_HINT, ProviderConfigError, ProviderError } from "./providers/ProviderError";

// Maps any thrown error to a clean, user-safe JSON body. Never leaks keys,
// hostnames or raw upstream errors. Always HTTP 200 so the client can render a
// friendly status instead of a stack trace.
export function errorResponse(err: unknown): Response {
  if (err instanceof ProviderConfigError) {
    return Response.json({
      ok: false,
      code: err.code,
      kind: err.kind,
      provider: err.provider,
      missing: err.missing,
      error: err.message,
      hint: CONFIG_HINT,
    });
  }
  if (err instanceof ProviderError) {
    return Response.json({ ok: false, code: err.code, error: err.message });
  }
  // Log a generic line server-side (never the error object, which could carry
  // request details) and return a sanitised message.
  console.error("[onboarding] unexpected server error");
  return Response.json({ ok: false, code: "server_error", error: "Something went wrong on the server." });
}
