import { getProviderStatus } from "@/lib/voicebuild/providers/providerConfig.server";
import { guardVoicebuild } from "@/lib/voicebuild/guard.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Provider status — ADMIN/MODERATOR ONLY.
 *
 * It reports which AI processors are configured. That is infrastructure detail: it
 * tells an attacker which third parties to target and which keys exist to burn. It
 * was previously readable by anyone on the internet, unauthenticated.
 *
 * A non-admin gets 404, not 403 — a normal user should not learn this surface
 * exists at all.
 */
export async function GET(req: Request) {
  const gate = await guardVoicebuild(req, { adminOnly: true });
  if (!gate.ok) return gate.response;

  // Presence booleans only; never a secret value.
  return Response.json(getProviderStatus(), {
    headers: { "cache-control": "private, no-store" },
  });
}
