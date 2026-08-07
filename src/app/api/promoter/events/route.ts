import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { enforceLimit } from "@/lib/rate-limit/guard";
import { POLICY } from "@/lib/rate-limit";
import { publishDraft } from "@/lib/promoter/repo";
import type { EditableDraft } from "@/lib/promoter/draft";

/**
 * Publish a draft as a real, public event.
 *
 * ── Access-control walk (CLAUDE.md rules 1–8) ───────────────────────────────
 * 1. Authenticated first — 401 before any work.
 * 2. The capability check lives in `publishDraft`, not here, so it holds for
 *    every caller of that function. Only a VERIFIED promoter has
 *    `publishEvents`; a pending applicant has nothing.
 * 3. Allow-listed, never mass-assigned. The body is picked apart field by field
 *    below and `promoterOrgId`, `source`, `status`, `slug` and `lockedFields`
 *    are all decided by the SERVER. A promoter posting
 *    `{"promoterOrgId":"someone-else"}` changes nothing — which is the whole
 *    reason this is not a spread of `req.json()` into `prisma.event.create`.
 * 4. The write is a single transaction (see publishDraft): an event whose bouts
 *    half-wrote would appear publicly and take predictions on a partial card.
 * 5. The service layer throws human strings on purpose and no raw Prisma error
 *    can reach the client — the writes are creates with server-generated unique
 *    slugs, resolved by retry rather than by racing a constraint.
 * 8. JSON POST behind the sameSite=lax session cookie.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to publish an event." }, { status: 401 });

  const limited = await enforceLimit(req, "promoter-publish", POLICY.interaction, user.id);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as Partial<EditableDraft> & { posterUrl?: string | null };

  // ── The allow-list ─────────────────────────────────────────────────────
  // Everything the client may contribute, and nothing else. Built explicitly
  // rather than spread, so a field added to the client shape later cannot
  // silently become a writable column.
  const str = (v: unknown, max = 200): string =>
    typeof v === "string" ? v.slice(0, max).trim() : "";

  const draft = {
    eventName: str(body.eventName, 120),
    promotion: str(body.promotion, 80),
    date: str(body.date, 10),
    doorsTime: str(body.doorsTime, 5),
    firstBellTime: str(body.firstBellTime, 5),
    timezoneAbbr: str(body.timezoneAbbr, 8),
    venue: str(body.venue, 160),
    city: str(body.city, 80),
    countryCode: str(body.countryCode, 40),
    broadcaster: str(body.broadcaster, 80),
    ticketUrl: str(body.ticketUrl, 500),
    // A card is capped: a poster does not carry 200 bouts, and each one costs
    // fighter resolution inside the transaction.
    bouts: (Array.isArray(body.bouts) ? body.bouts : []).slice(0, 30).map((b, i) => ({
      id: `b-${i}`,
      redName: str(b?.redName, 80),
      blueName: str(b?.blueName, 80),
      weightClass: str(b?.weightClass, 60),
      titleFight: b?.titleFight === true,
      uncertain: false,
    })),
    uncertainFields: new Set<string>(),
    leftovers: [],
    // Only a URL we issued. A promoter-supplied poster URL would let anyone
    // point a public event page at an arbitrary host.
    posterUrl: typeof body.posterUrl === "string" && body.posterUrl.startsWith("/")
      ? body.posterUrl
      : null,
  };

  try {
    const event = await publishDraft(user.id, draft);
    return NextResponse.json(event);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't publish that event." },
      { status: 400 },
    );
  }
}

export const dynamic = "force-dynamic";
