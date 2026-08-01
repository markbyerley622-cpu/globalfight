// ════════════════════════════════════════════════════════════════════════
//  Storage configuration validation. PURE and DEPENDENCY-FREE.
//
//  Dependency-free is a hard requirement, not a preference: startup-guard.ts
//  imports this, and startup-guard is imported by instrumentation.ts, where
//  anything pulling in a native module (sharp, the AWS SDK) fails to resolve
//  `child_process` and breaks boot. Same rule as evidence/config.ts.
//
//  WHY THIS EXISTS
//
//  getStorage() selected a backend from STORAGE_PROVIDER alone:
//
//      case "s3":
//      case "r2": return s3Provider;
//
//  With STORAGE_PROVIDER=r2 and no R2_* variables it returned a fully-formed
//  s3Provider that reported itself as active object storage and then failed on
//  every single upload. Observed in the production env file: STORAGE_PROVIDER=r2,
//  R2_BUCKET unset, R2_ENDPOINT unset, both keys missing. A configuration that
//  reads healthy and cannot work is the same failure shape as a cron returning
//  200 for a run in which everything failed.
//
//  THE TWO STORAGE DOMAINS ARE NOT INTERCHANGEABLE
//
//  This app has two, and evidence/config.ts already refuses to start when they
//  are the same bucket ("Identity documents would be served publicly"). So:
//
//    public media   R2_/S3_/SUPABASE_/BLOB_  fighter images, posters, gym photos
//    identity docs  EVIDENCE_R2_*            passports and ID scans, never public
//
//  Nothing here may ever fall back from one to the other.
// ════════════════════════════════════════════════════════════════════════

export class StorageConfigurationError extends Error {
  readonly provider: string;
  readonly missing: string[];
  readonly requestedBy: string;

  constructor(provider: string, missing: string[], requestedBy: string) {
    super(
      `Missing storage configuration.\n\n` +
        `  Selected provider: ${provider}\n\n` +
        `  Required but missing:\n${missing.map((m) => `    ${m}`).join("\n")}\n\n` +
        `  Storage requested by:\n    ${requestedBy}\n\n` +
        `  This is the PUBLIC media bucket. Do not point it at EVIDENCE_R2_* — that is the\n` +
        `  private identity-document bucket and lib/evidence/config.ts refuses to start if\n` +
        `  the two are the same.`,
    );
    this.name = "StorageConfigurationError";
    this.provider = provider;
    this.missing = missing;
    this.requestedBy = requestedBy;
  }
}

/**
 * What each backend cannot run without.
 *
 * R2_PUBLIC_BASE_URL is required for r2/s3 because a stored object with no public
 * base URL cannot be rendered — the upload would "succeed" and produce an
 * unusable address.
 */
export const REQUIRED_BY_PROVIDER: Record<string, string[][]> = {
  // Each inner array is a set of alternatives; at least one must be present.
  s3: [
    ["R2_BUCKET", "S3_BUCKET"],
    ["R2_ENDPOINT", "S3_ENDPOINT"],
    ["R2_ACCESS_KEY_ID", "S3_ACCESS_KEY_ID"],
    ["R2_SECRET_ACCESS_KEY", "S3_SECRET_ACCESS_KEY"],
    ["R2_PUBLIC_BASE_URL", "S3_PUBLIC_BASE_URL"],
  ],
  supabase: [["SUPABASE_URL"], ["SUPABASE_SERVICE_ROLE_KEY"], ["SUPABASE_BUCKET"]],
  // The default. Stores nothing; callers keep the source URL. Always "valid".
  url: [],
};

/** STORAGE_PROVIDER value -> internal backend name. */
export function resolveProviderName(env: NodeJS.ProcessEnv = process.env): string {
  switch (env.STORAGE_PROVIDER ?? "url") {
    case "supabase": return "supabase";
    case "s3":
    case "r2": return "s3";
    default: return "url";
  }
}

export interface StorageDiagnostics {
  /** What STORAGE_PROVIDER asked for, verbatim. */
  requested: string;
  /** The backend that resolves to. */
  provider: string;
  bucket: string | null;
  /** Host only — never the full endpoint, which can carry an account id. */
  endpointHost: string | null;
  publicUrlConfigured: boolean;
  /** True when a usable configuration is present. */
  usable: boolean;
  /** Variable names only. No values, ever. */
  missing: string[];
}

const host = (url: string | undefined): string | null => {
  if (!url) return null;
  try { return new URL(url).host; } catch { return "(unparseable)"; }
};

/**
 * Inspect the storage configuration without touching the network.
 *
 * Reports EVERY missing variable rather than the first, so one deploy shows the
 * whole problem instead of revealing it one crash at a time. Never returns a
 * secret — only names, the bucket, and the endpoint host.
 */
export function validateStorageConfiguration(env: NodeJS.ProcessEnv = process.env): StorageDiagnostics {
  const requested = env.STORAGE_PROVIDER ?? "url";
  const provider = resolveProviderName(env);
  const groups = REQUIRED_BY_PROVIDER[provider] ?? [];

  const missing: string[] = [];
  for (const alternatives of groups) {
    if (!alternatives.some((name) => (env[name] ?? "").trim() !== "")) {
      missing.push(alternatives.join(" or "));
    }
  }

  return {
    requested,
    provider,
    bucket: env.R2_BUCKET ?? env.S3_BUCKET ?? env.SUPABASE_BUCKET ?? null,
    endpointHost: host(env.R2_ENDPOINT ?? env.S3_ENDPOINT ?? env.SUPABASE_URL),
    publicUrlConfigured: Boolean(env.R2_PUBLIC_BASE_URL ?? env.S3_PUBLIC_BASE_URL ?? env.SUPABASE_URL),
    usable: missing.length === 0,
    missing,
  };
}

/**
 * Throw unless the selected backend can actually work.
 *
 * `requestedBy` names the subsystem, so the error says which feature was trying
 * to store something rather than leaving the operator to guess.
 */
export function assertStorageConfigured(
  requestedBy: string,
  env: NodeJS.ProcessEnv = process.env,
): StorageDiagnostics {
  const diag = validateStorageConfiguration(env);
  if (!diag.usable) throw new StorageConfigurationError(diag.provider, diag.missing, requestedBy);
  return diag;
}

/** One-line, secret-free summary for boot logs and the doctor scripts. */
export function describeStorage(diag: StorageDiagnostics): string {
  if (diag.provider === "url") {
    return "storage: none (STORAGE_PROVIDER unset) — processed images keep their source URL, nothing is stored";
  }
  return (
    `storage: ${diag.requested} -> ${diag.provider}` +
    ` · bucket=${diag.bucket ?? "(unset)"}` +
    ` · endpoint=${diag.endpointHost ?? "(unset)"}` +
    ` · publicUrl=${diag.publicUrlConfigured ? "yes" : "NO"}` +
    ` · ${diag.usable ? "usable" : `UNUSABLE (missing: ${diag.missing.join(", ")})`}`
  );
}
