import "server-only";
import { prisma } from "@/lib/db";
import { slugify } from "@/lib/utils";
import { WIKI_SOURCE } from "./map";

// ════════════════════════════════════════════════════════════════════════════
//  Production data-integrity audit for Wikipedia-sourced bouts.
//
//  A historical repair ran while the provider still attached a whole parsed page to
//  one event. Wikipedia season pages ("2026 in Bare Knuckle Fighting Championship")
//  carry every card of the year, so an event that holds 11 bouts could have been
//  given several hundred. Future writes are fixed; this decides whether the past was
//  damaged, and it MEASURES rather than assumes.
//
//  THE HARD PART: `Fight` recorded createdAt and nothing else. There was no source,
//  no page, no job id — so "which bouts did that repair write?" cannot be answered
//  directly for anything written before FightImport existed. Two independent signals
//  are used instead, and both must agree before a bout is even a candidate:
//
//    1. PROVENANCE, where we have it (FightImport, source="wikipedia"). Exact.
//    2. SLUG SHAPE, for anything older. persistAggregated slugs a bout it creates as
//       `{eventName}-{red}-vs-{blue}`, while the odds pipeline — which created
//       production's real boxing/MMA bouts — uses `{red}-vs-{blue}`. So a bout whose
//       slug carries its event's name was written by the aggregated pipeline, not by
//       odds. That is a fingerprint of HOW it was written, not proof it is wrong,
//       which is why it is never sufficient on its own.
//
//  Anything referenced by a pick, a battle, a prediction or odds is never a
//  candidate, whatever the signals say. Losing a real bout is worse than keeping a
//  suspect one.
// ════════════════════════════════════════════════════════════════════════════

/** A real fight card. UFC/BKFC run 10–14; a grand prix or a stacked show can reach ~18. */
export const NORMAL_MAX = 18;
/** Above this a card is worth a human look. */
export const REVIEW_MAX = 30;

export type CardVerdict = "normal" | "review" | "contaminated";

export function verdictFor(boutCount: number): CardVerdict {
  if (boutCount > REVIEW_MAX) return "contaminated";
  if (boutCount > NORMAL_MAX) return "review";
  return "normal";
}

export interface BoutAudit {
  id: string;
  slug: string;
  red: string;
  blue: string;
  result: string;
  createdAt: string;
  /** Recorded provenance, when the import that wrote it was new enough to leave any. */
  source: string | null;
  sourceRef: string | null;
  /** This import CREATED the bout (vs merely updated it). Only created rows are removable. */
  createdByImport: boolean;
  /** Slug is prefixed with the event's name — written by the aggregated pipeline. */
  namePrefixedSlug: boolean;
  /** Referenced by user data — never removable, whatever else is true. */
  picks: number;
  battles: number;
  predictions: number;
  odds: number;
  /** Everything above, resolved into one decision. */
  suspect: boolean;
  keepReason: string | null;
}

export interface EventAudit {
  id: string;
  slug: string;
  name: string;
  promotion: string | null;
  date: string;
  boutCount: number;
  verdict: CardVerdict;
  /** Wikipedia page(s) recorded against this event, when provenance exists. */
  wikiRefs: string[];
  bouts: BoutAudit[];
  suspectCount: number;
  /** Bouts that look imported but are referenced by user data — kept, and reported. */
  protectedCount: number;
}

export interface AuditOpts {
  /** Only consider bouts created at/after this instant — scope to a known bad run. */
  since?: Date;
  /** Only audit events at/over this bout count. Default: everything over NORMAL_MAX. */
  minBouts?: number;
  limit?: number;
}

/**
 * Audit every event whose bout count is implausible for a real card.
 *
 * Read-only. Returns what it found and why; it decides nothing on its own.
 */
export async function auditWikicards(opts: AuditOpts = {}): Promise<EventAudit[]> {
  const minBouts = opts.minBouts ?? NORMAL_MAX + 1;
  const limit = opts.limit ?? 50;

  // Postgres cannot filter on a relation COUNT in a where-clause, so take the
  // biggest cards and filter in app. Bounded and indexed by the orderBy.
  const rows = await prisma.event.findMany({
    where: { fights: { some: {} } },
    orderBy: { fights: { _count: "desc" } },
    take: limit,
    select: {
      id: true, slug: true, name: true, promotion: true, date: true,
      _count: { select: { fights: true } },
    },
  });
  const flagged = rows.filter((e) => e._count.fights >= minBouts);
  if (!flagged.length) return [];

  const out: EventAudit[] = [];
  for (const ev of flagged) out.push(await auditEvent(ev, opts));
  return out;
}

/** Audit one event by id or slug — for verifying a specific report. */
export async function auditEventBySlug(slug: string, opts: AuditOpts = {}): Promise<EventAudit | null> {
  const ev = await prisma.event.findUnique({
    where: { slug },
    select: {
      id: true, slug: true, name: true, promotion: true, date: true,
      _count: { select: { fights: true } },
    },
  });
  return ev ? auditEvent(ev, opts) : null;
}

type EventRow = {
  id: string; slug: string; name: string; promotion: string | null; date: Date;
  _count: { fights: number };
};

async function auditEvent(ev: EventRow, opts: AuditOpts): Promise<EventAudit> {
  const fights = await prisma.fight.findMany({
    where: { eventId: ev.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, slug: true, result: true, createdAt: true,
      red: { select: { name: true } },
      blue: { select: { name: true } },
      _count: { select: { picks: true, battles: true, predictions: true, odds: true } },
    },
  });

  // Provenance, where any exists. Additive table — a database without it audits on
  // slug shape alone, and says so by reporting source: null.
  const imports = await prisma.fightImport
    .findMany({
      where: { fightId: { in: fights.map((f) => f.id) } },
      select: { fightId: true, source: true, sourceRef: true, created: true },
    })
    .catch(() => [] as { fightId: string; source: string; sourceRef: string | null; created: boolean }[]);
  const importBy = new Map(imports.map((i) => [i.fightId, i]));

  const namePrefix = `${slugify(ev.name)}-`;
  const bouts: BoutAudit[] = fights.map((f) => {
    const imp = importBy.get(f.id);
    const refs = f._count;
    const referenced =
      refs.picks > 0 || refs.battles > 0 || refs.predictions > 0 || refs.odds > 0;

    const inWindow = !opts.since || f.createdAt >= opts.since;
    const wikiCreated = imp?.source === WIKI_SOURCE && imp.created;
    const namePrefixed = f.slug.startsWith(namePrefix);

    // A bout is suspect only when it was written by the aggregated pipeline (by
    // provenance where we have it, by slug shape where we do not), inside the window
    // being audited, and nothing depends on it.
    let keepReason: string | null = null;
    if (referenced) {
      keepReason = `referenced (picks:${refs.picks} battles:${refs.battles} predictions:${refs.predictions} odds:${refs.odds})`;
    } else if (!inWindow) {
      keepReason = "created before the audited window";
    } else if (imp && !wikiCreated) {
      keepReason = `provenance says ${imp.source}${imp.created ? "" : " (updated, not created)"}`;
    } else if (!imp && !namePrefixed) {
      keepReason = "slug is not aggregated-pipeline shaped";
    }

    return {
      id: f.id, slug: f.slug, red: f.red.name, blue: f.blue.name,
      result: f.result, createdAt: f.createdAt.toISOString(),
      source: imp?.source ?? null,
      sourceRef: imp?.sourceRef ?? null,
      createdByImport: imp?.created ?? false,
      namePrefixedSlug: namePrefixed,
      picks: refs.picks, battles: refs.battles,
      predictions: refs.predictions, odds: refs.odds,
      suspect: keepReason === null,
      keepReason,
    };
  });

  const wikiRefs = [...new Set(imports.filter((i) => i.source === WIKI_SOURCE).map((i) => i.sourceRef).filter(Boolean))] as string[];

  return {
    id: ev.id, slug: ev.slug, name: ev.name, promotion: ev.promotion,
    date: ev.date.toISOString(), boutCount: ev._count.fights,
    verdict: verdictFor(ev._count.fights),
    wikiRefs,
    bouts,
    suspectCount: bouts.filter((b) => b.suspect).length,
    protectedCount: bouts.filter((b) => !b.suspect && b.keepReason?.startsWith("referenced")).length,
  };
}
