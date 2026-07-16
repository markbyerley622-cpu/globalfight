// ════════════════════════════════════════════════════════════════════════
//  AUTH_SECRET resolution — fail closed.
//
//  There is deliberately no production fallback. A signed-JWT session scheme
//  with a guessable signing key is equivalent to no authentication at all: any
//  visitor can mint a cookie for any user, including an ADMIN. The previous
//  implementation fell back to a constant that was committed to a public repo.
//
//  Production: AUTH_SECRET must be present, non-placeholder, and long enough.
//  Anything else throws at startup so a misconfigured deploy dies loudly rather
//  than serving forgeable sessions.
//
//  Dev/test: an explicitly-scoped, clearly-labelled development key is allowed
//  so contributors don't need to provision secrets to run the app locally. It is
//  unreachable in production because isProd() is checked first.
// ════════════════════════════════════════════════════════════════════════

/** Minimum accepted length. `npx auth secret` emits 44 chars (32 bytes b64). */
export const MIN_SECRET_LENGTH = 32;

/**
 * Values that look like a secret but aren't. Matched case-insensitively as
 * substrings, so "dev-only-insecure-secret-change-me-in-production" (the old
 * committed fallback) and anything containing "change-me" are rejected.
 */
const PLACEHOLDER_MARKERS = [
  "change-me",
  "changeme",
  "dev-only",
  "insecure",
  "placeholder",
  "your-secret",
  "secret-here",
  "example",
  "generate-with",
  "xxxxxx",
];

const DEV_SECRET = "combat-register-development-only-secret-not-for-production";

export class AuthSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthSecretError";
  }
}

function isProd(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production";
}

/**
 * Validate a candidate secret. Returns null when acceptable, otherwise a reason
 * suitable for a startup error. The reason never contains the secret itself.
 */
export function validateSecret(raw: string | undefined): string | null {
  if (raw === undefined) return "AUTH_SECRET is not set";
  const value = raw.trim();
  if (value === "") return "AUTH_SECRET is empty";
  if (value.length < MIN_SECRET_LENGTH) {
    return `AUTH_SECRET is too short (${value.length} chars; minimum ${MIN_SECRET_LENGTH})`;
  }
  const lowered = value.toLowerCase();
  const marker = PLACEHOLDER_MARKERS.find((m) => lowered.includes(m));
  if (marker) return `AUTH_SECRET looks like placeholder text (contains "${marker}")`;
  // A secret with almost no variety (e.g. "aaaa…") passes a length check but has
  // no entropy. Require a reasonable number of distinct characters.
  if (new Set(value).size < 8) return "AUTH_SECRET has insufficient entropy (too few distinct characters)";
  return null;
}

/**
 * Resolve the signing secret for the current environment.
 *
 * @throws AuthSecretError in production when AUTH_SECRET is missing or invalid.
 */
export function resolveAuthSecret(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.AUTH_SECRET;
  const problem = validateSecret(raw);

  if (!problem) return (raw as string).trim();

  if (isProd(env)) {
    // Never log the value; the reason is safe (it never echoes the secret).
    throw new AuthSecretError(
      `${problem}. Set a strong AUTH_SECRET (e.g. \`npx auth secret\`) in the deployment environment. ` +
        "Refusing to start: without it, session cookies would be forgeable.",
    );
  }

  return DEV_SECRET;
}
