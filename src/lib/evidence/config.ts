// Boot-time configuration guards for identity-document storage.
//
// Deliberately dependency-free (no sharp, no AWS SDK, no Prisma). `instrumentation.ts`
// imports this at server boot, and anything it pulls in gets bundled into the
// instrumentation context — where native modules like sharp cannot resolve
// `child_process` and would break startup.

/**
 * Refuse to run if identity documents could land somewhere world-readable.
 *
 * Two ways that happens, both fatal:
 *   • the evidence bucket IS the public image bucket (which is fronted by a CDN);
 *   • the evidence bucket has a public base URL configured.
 *
 * This is a startup assertion rather than a runtime check because a misconfigured
 * bucket must never accept a single upload.
 */
export function assertPrivateBucketConfig(env: NodeJS.ProcessEnv = process.env): void {
  const evidenceBucket = env.EVIDENCE_R2_BUCKET;
  if (!evidenceBucket) return;

  const publicBucket = env.R2_BUCKET ?? env.S3_BUCKET;
  if (publicBucket && publicBucket === evidenceBucket) {
    throw new Error(
      "EVIDENCE_R2_BUCKET must not be the same bucket as the public image bucket (R2_BUCKET). " +
        "Identity documents would be served publicly. Provision a separate, private bucket.",
    );
  }

  if (env.EVIDENCE_R2_PUBLIC_BASE_URL) {
    throw new Error(
      "EVIDENCE_R2_PUBLIC_BASE_URL is set. The evidence bucket must have NO public base URL — " +
        "identity documents are streamed through an authorized endpoint, never linked.",
    );
  }
}
