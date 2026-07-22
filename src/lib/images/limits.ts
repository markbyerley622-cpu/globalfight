// ════════════════════════════════════════════════════════════════════════════
//  Upload limits — the numbers BOTH sides need.
//
//  Deliberately separate from upload-policy.ts, which is `server-only`: the
//  client needs these constants to show a fast local error and to set the file
//  picker's `accept`, and importing a server-only module from a client
//  component fails the build.
//
//  Same pattern as onboarding-options.ts: one declaration, two consumers, so
//  the client can never offer something the server rejects.
// ════════════════════════════════════════════════════════════════════════════

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

/** What a browser file picker may offer, and what the server accepts. */
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;

/** `accept` attribute for <input type="file">. */
export const IMAGE_ACCEPT = ALLOWED_IMAGE_TYPES.join(",");
