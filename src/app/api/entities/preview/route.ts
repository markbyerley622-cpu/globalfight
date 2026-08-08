import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { enforceLimit } from "@/lib/rate-limit/guard";
import { POLICY } from "@/lib/rate-limit";
import { loadPreviews, type PreviewRequest } from "@/lib/rich-text/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ════════════════════════════════════════════════════════════════════════════
//  POST /api/entities/preview — hover-card data for a BATCH of entities.
//
//  The one door for every preview in the product. A body full of mentions, an
//  event chip and a gym chip resolve in a single round trip; see
//  lib/rich-text/cache for the client half that batches into it.
//
//  ── Why POST for a read ──────────────────────────────────────────────────
//  The request is a LIST of (kind, id) pairs. As a GET that is a query string
//  that grows past what proxies will carry and that varies per viewer anyway,
//  so it could never be cached usefully. POST with `no-store` is the honest
//  shape: this is a lookup, not a document.
//
//  It is also why CSRF is not a concern here despite being a POST — it writes
//  nothing (CLAUDE.md rule 8 governs state-changing endpoints), and it is
//  JSON-only, which a cross-site form post cannot produce.
//
//  ── Access-control walk (CLAUDE.md rules 1–8) ────────────────────────────
//  1. Authentication: NOT required, deliberately. Every field any loader
//     returns is already on a public page, and the entities being previewed are
//     inside content the reader is already allowed to read. The viewer is
//     resolved anyway, because presence is viewer-scoped — see the mention
//     loader, where presenceDtoFor is the single privacy gate.
//  2. Ownership: nothing here is owner-scoped. Each loader is responsible for
//     returning only what its kind may publish, in the service layer rather
//     than in this route, so a second caller cannot bypass it.
//  3–5. No writes: no mass assignment, no concurrency, no Prisma error can
//     reach the client (a loader that throws yields an empty list, not a
//     message).
//  6. No existence oracle: an id that does not resolve — because it is
//     nonsense, deleted, or filtered — is simply ABSENT from `previews`,
//     identically in all three cases.
//  7. No outbound fetch from user input.
//  8. JSON-only, and non-mutating.
//
//  Rate-limited under the shared `interaction` ceiling, keyed to the account
//  when there is one and to the source host when there is not — a hover surface
//  is the easiest thing in the product to point a script at.
// ════════════════════════════════════════════════════════════════════════════

/**
 * The most entities one request may ask for.
 *
 * Matches the client's own batch cap. It is what stops a caller turning one
 * request into a thousand-row scan across five tables: anything beyond this is
 * TRUNCATED rather than refused, because a client that legitimately has more
 * chips on screen should still get the first screenful rather than an error.
 */
const MAX_BATCH = 24;

/** Ids are cuids or slugs. Anything longer is not one, and is dropped early. */
const MAX_ID_LEN = 64;

export async function POST(req: Request) {
  // Resolved but not required. `catch` because an expired or tampered cookie
  // must degrade to anonymous rather than 500 a public read.
  const user = await getCurrentUser().catch(() => null);

  const limited = await enforceLimit(req, "entity-preview", POLICY.interaction, user?.id ?? null);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const raw = (body as { entities?: unknown })?.entities;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ previews: [] }, { headers: { "cache-control": "private, no-store" } });
  }

  // Shape-checked here and deduped, so a client repeating the same id twenty
  // times still costs one lookup.
  const seen = new Set<string>();
  const requested: PreviewRequest[] = [];
  for (const item of raw) {
    if (requested.length >= MAX_BATCH) break;
    if (!item || typeof item !== "object") continue;
    const { type, id } = item as { type?: unknown; id?: unknown };
    if (typeof type !== "string" || typeof id !== "string") continue;
    if (!id || id.length > MAX_ID_LEN || type.length > 32) continue;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    requested.push({ type, id });
  }

  const previews = await loadPreviews(requested, { viewerId: user?.id ?? null });

  return NextResponse.json(
    { previews },
    {
      // Viewer-dependent (presence) and cheap to recompute. A shared cache here
      // would serve one reader's presence view to everybody.
      headers: { "cache-control": "private, no-store" },
    },
  );
}
