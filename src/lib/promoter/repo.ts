import "server-only";
import { prisma } from "@/lib/db";
import { slugify } from "@/lib/utils";
import { toCountryCode } from "@/lib/countries";
import {
  promoterState,
  promoterCapabilities,
  type PromoterState,
} from "@/lib/promoter/verification";
import type { FightMethod } from "@prisma/client";
import { promoterEventLocks, promoterFightLocks, promoterResultLocks } from "@/lib/promoter/locking";
import type { EditableDraft } from "@/lib/promoter/draft";
import { toEventDate } from "@/lib/promoter/draft";

// ════════════════════════════════════════════════════════════════════════════
//  Promoter hosting — the service layer. EVERY ownership check lives here.
//
//  Per CLAUDE.md rule 2, the capability check is in this module rather than in
//  the route, so it holds for every caller of these functions rather than for
//  the one HTTP path someone remembered to guard.
// ════════════════════════════════════════════════════════════════════════════

export interface ViewerPromoter {
  orgId: string;
  orgName: string;
  state: PromoterState;
}

/**
 * The viewer's promoter organisation and its derived state, or null.
 *
 * ONE query, and the derivation is the pure function every surface shares — so
 * the dashboard, the API and the public badge cannot reach different answers
 * about whether the same person may publish.
 */
export async function getViewerPromoter(userId: string): Promise<ViewerPromoter | null> {
  const org = await prisma.promoterOrg.findFirst({
    where: {
      OR: [
        { ownerId: userId },
        // An applicant with no ownership yet still needs to see their pending
        // state, or the flow looks like it silently failed.
        { claims: { some: { userId } } },
      ],
    },
    select: {
      id: true, name: true, verified: true, ownerId: true, suspendedAt: true,
      claims: { where: { userId }, select: { status: true } },
    },
  });
  if (!org) return null;

  return {
    orgId: org.id,
    orgName: org.name,
    state: promoterState({
      verified: org.verified,
      ownerId: org.ownerId,
      suspendedAt: org.suspendedAt,
      claimStatuses: org.claims.map((c) => c.status),
    }),
  };
}

/** Throws a human-readable refusal the route can pass through safely (rule 5). */
function requireCapability(
  promoter: ViewerPromoter | null,
  capability: Parameters<typeof promoterCapabilities>[0] extends never ? never : keyof ReturnType<typeof promoterCapabilities>,
): asserts promoter is ViewerPromoter {
  if (!promoter) throw new Error("You're not set up to host events yet.");
  if (!promoterCapabilities(promoter.state)[capability]) {
    throw new Error("Your promoter account can't do that right now.");
  }
}

/** A slug nobody else holds. Suffixes rather than throwing on a collision. */
async function uniqueEventSlug(name: string, date: Date): Promise<string> {
  const base = slugify(`${name}-${date.getFullYear()}`) || `event-${date.getFullYear()}`;
  for (let n = 0; n < 40; n++) {
    const candidate = n === 0 ? base : `${base}-${n + 1}`;
    const taken = await prisma.event.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  // Deterministic enough and guaranteed free in practice.
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Record a result on a bout the caller's organisation owns.
 *
 * ── Why the ownership check is INSIDE the write ───────────────────────────
 * The `where` proves the chain — this fight, on an event, belonging to the
 * caller's org — in the same statement that sets the columns. A separate
 * "can I?" read followed by an update is both a race and an extra way to get
 * the check wrong; `updateMany` makes a non-owner's attempt a silent no-op.
 *
 * The result fields are locked at the moment they are written, not at publish:
 * locking them empty earlier would stop the ingest pipeline filling in a result
 * the promoter never got round to entering.
 */
export async function recordPromoterResult(
  userId: string,
  eventId: string,
  input: {
    fightId: string;
    winner: "RED" | "BLUE" | "DRAW" | "NO_CONTEST";
    method: FightMethod | null;
    round: number | null;
    time: string | null;
  },
): Promise<void> {
  const promoter = await getViewerPromoter(userId);
  requireCapability(promoter, "recordResults");

  const fight = await prisma.fight.findFirst({
    where: {
      id: input.fightId,
      eventId,
      event: { promoterOrgId: promoter.orgId },
    },
    select: { id: true, redId: true, blueId: true, lockedFields: true },
  });
  // Same answer for "not yours" and "does not exist" — rule 6.
  if (!fight) throw new Error("That bout isn't on your card.");

  const winnerId =
    input.winner === "RED" ? fight.redId : input.winner === "BLUE" ? fight.blueId : null;

  await prisma.fight.updateMany({
    where: { id: fight.id, event: { promoterOrgId: promoter.orgId } },
    data: {
      result: input.winner === "DRAW" ? "DRAW" : input.winner === "NO_CONTEST" ? "NO_CONTEST" : "WIN",
      winnerId,
      method: input.method,
      roundEnded: input.round,
      timeEnded: input.time,
      lockedFields: promoterResultLocks(fight.lockedFields),
    },
  });
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** A free slug for a table with a unique slug column. */
async function freeSlug(
  base: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const root = base || "item";
  for (let n = 0; n < 40; n++) {
    const candidate = n === 0 ? root : `${root}-${n + 1}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

/**
 * Find the fighter this name refers to, or create a stub.
 *
 * ── The matching bar, and why it is set where it is ───────────────────────
 * An EXACT case-insensitive name match, and nothing looser. Fuzzy matching
 * would attach a regional promoter's debutant to a well-known fighter with a
 * similar name, and the consequence is not cosmetic: the bout joins that
 * fighter's professional record, their profile, and any ranking that reads it.
 * The promoter cannot undo it and would have no reason to notice.
 *
 * A duplicate stub, by contrast, is a routine merge — the registry already has
 * a dedupe engine and an admin queue for exactly this. So the failure mode is
 * chosen deliberately: too many rows rather than a wrong attribution.
 */
async function resolveOrCreateFighter(tx: Tx, name: string): Promise<string> {
  const existing = await tx.fighter.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    // Oldest first: where a stub and a real profile share a name, the
    // established row is the one to attach to.
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (existing) return existing.id;

  const slug = await freeSlug(slugify(name), async (c) =>
    Boolean(await tx.fighter.findUnique({ where: { slug: c }, select: { id: true } })),
  );
  const created = await tx.fighter.create({ data: { slug, name }, select: { id: true } });
  return created.id;
}

async function uniqueFightSlug(tx: Tx, red: string, blue: string, date: Date): Promise<string> {
  const base = slugify(`${red}-vs-${blue}-${date.getFullYear()}`);
  return freeSlug(base, async (c) =>
    Boolean(await tx.fight.findUnique({ where: { slug: c }, select: { id: true } })),
  );
}

export interface PublishResult { id: string; slug: string }

/**
 * Publish a promoter's draft as a real event.
 *
 * ── Why one transaction ───────────────────────────────────────────────────
 * An event whose bouts half-wrote is worse than no event: it appears in the
 * public grid, takes predictions on the bouts that landed, and the promoter has
 * no way to tell which are missing. Either the whole card exists or none of it
 * does.
 *
 * ── Why every write carries locks ─────────────────────────────────────────
 * These rows are the same rows the scrapers rewrite on cron. Without
 * `lockedFields` the promoter's venue and — worse — their bout ORDER would be
 * silently replaced within hours. See lib/promoter/locking.
 */
export async function publishDraft(
  userId: string,
  draft: EditableDraft & { posterUrl?: string | null },
): Promise<PublishResult> {
  const promoter = await getViewerPromoter(userId);
  requireCapability(promoter, "publishEvents");

  const name = draft.eventName.trim();
  const date = toEventDate(draft.date, draft.firstBellTime || draft.doorsTime);
  if (!name) throw new Error("Name the event before publishing.");
  if (!date) throw new Error("Add the date before publishing.");
  const bouts = draft.bouts.filter((b) => b.redName.trim() && b.blueName.trim());
  if (bouts.length === 0) throw new Error("Add at least one bout before publishing.");

  const slug = await uniqueEventSlug(name, date);

  const event = await prisma.$transaction(async (tx) => {
    const created = await tx.event.create({
      data: {
        slug,
        name,
        date,
        // ANNOUNCED, not SCHEDULED: the card is public and real, and the
        // lifecycle moves it on from here. Publishing is not the same claim as
        // "this is confirmed and locked in".
        status: "ANNOUNCED",
        source: "PROMOTER",
        promoterOrgId: promoter.orgId,
        promotion: draft.promotion.trim() || promoter.orgName,
        venue: draft.venue.trim() || null,
        city: draft.city.trim() || null,
        countryCode: toCountryCode(draft.countryCode) ?? null,
        broadcaster: draft.broadcaster.trim() || null,
        ticketUrl: draft.ticketUrl.trim() || null,
        posterUrl: draft.posterUrl ?? null,
        lockedFields: promoterEventLocks([]),
      },
      select: { id: true, slug: true },
    });

    for (const [i, bout] of bouts.entries()) {
      // Fight.redId/blueId are REQUIRED foreign keys — there is no name column
      // on a bout — so every corner must resolve to a real Fighter row before
      // the card can exist at all.
      const [redId, blueId] = await Promise.all([
        resolveOrCreateFighter(tx, bout.redName.trim()),
        resolveOrCreateFighter(tx, bout.blueName.trim()),
      ]);

      await tx.fight.create({
        data: {
          slug: await uniqueFightSlug(tx, bout.redName, bout.blueName, date),
          eventId: created.id,
          // Fight.date is required and is its OWN column, not derived from the
          // event: a bout can be moved to another card without the event's date
          // following it. On publish they are the same instant by definition.
          date,
          redId,
          blueId,
          orderOnCard: i,
          mainEvent: i === 0,
          coMain: i === 1,
          titleFight: bout.titleFight,
          lockedFields: promoterFightLocks([]),
        },
      });
    }

    return created;
  });

  return event;
}
