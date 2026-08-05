// Next.js server-boot hook (runs once when the Node server starts, not at build
// and not on the edge runtime).
//
// It does NOT create, promote, or modify any account. A previous version
// provisioned a fixed administrator — with a password committed to this public
// repository — on every single boot. Administrator creation is now exclusively a
// one-off CLI operation: `npm run admin:bootstrap` (scripts/bootstrap-admin.ts).
//
// What boot DOES do is refuse to start when the configuration would make the app
// behave insecurely: a forgeable session secret, a public evidence bucket, a
// missing private bucket, bootstrap credentials left armed on a live service.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Fail closed. Throws (and kills the boot) on any unsafe production config.
  // Deliberately NOT wrapped in try/catch — that is the entire point.
  const { assertSafeStartup } = await import("@/lib/startup-guard");
  assertSafeStartup();

  if (!process.env.DATABASE_URL) return; // local/dev without a DB — skip quietly

  try {
    const { purgeProfanity } = await import("@/lib/moderation/purge");
    const n = await purgeProfanity();
    if (n) console.log(`[boot] purged ${n} profane item(s)`);
  } catch (e) {
    console.warn("[boot] profanity purge skipped:", (e as Error).message);
  }

  // Opt-in, one-off compliance scrub of unlicensed re-hosted fighter photos.
  if (process.env.SCRUB_PHOTOS_ON_BOOT === "true") {
    try {
      const { scrubUnlicensedPhotos } = await import("@/lib/moderation/scrub-photos");
      const r = await scrubUnlicensedPhotos({ apply: true, deleteFiles: process.env.SCRUB_DELETE_FILES === "true" });
      console.log(`[boot] photo scrub: ${r.updated}/${r.total} fighters dropped to placeholder, ${r.filesDeleted} files deleted`);
    } catch (e) {
      console.warn("[boot] photo scrub skipped:", (e as Error).message);
    }
  }
}

/**
 * EVERY server-side error Next catches, in one place.
 *
 * `onRequestError` is the framework's official hook and it fires for things a
 * try/catch in application code cannot reach: React Server Component render
 * faults, route-handler throws, streaming failures, Server Action errors. Before
 * this, those surfaced as a digest in the platform log and nothing else — the
 * digest is the only thing the user-facing error page can show, and there was
 * nothing on the other side to correlate it against.
 *
 * Deliberately defensive: an error inside the error reporter must never replace
 * the original error, so the whole body is wrapped.
 */
export async function onRequestError(
  err: unknown,
  request: { path?: string; method?: string; headers?: Record<string, string> },
  context: { routerKind?: string; routePath?: string; routeType?: string },
) {
  try {
    const { reportError } = await import("@/lib/observability/report");
    reportError(err, "error", {
      source: `${context?.routerKind ?? "route"}:${context?.routeType ?? "render"}`,
      path: request?.path ?? context?.routePath,
      method: request?.method,
      headers: request?.headers,
      // The digest Next shows the user is on the error object; carrying it here
      // is what makes a screenshot traceable to this stack.
      digest: (err as { digest?: string })?.digest ?? null,
    });
  } catch {
    /* reporting must never mask the original failure */
  }
}
