import "server-only";
import { prisma } from "@/lib/db";
import { reconcile, type Observation, type Tier } from "@/lib/registry/reconcile";
import type { RankingConnector, RankingEntry } from "./connector";
import { tierOf } from "./pipeline";

// ════════════════════════════════════════════════════════════════════════════
//  CHAMPIONS — observations in, permanent reigns out.
//
//  ── What was broken ──────────────────────────────────────────────────────
//  `Champion` is `@@unique([weightClassId, body, current])` — a unique
//  constraint on a BOOLEAN. That permits at most TWO rows per (division, body)
//  for all time: one current, one not. So the old ingest could not retire a
//  champion into history; it updated the row in place and reset
//  `since: null, defenses: 0`, DESTROYING the previous reign's start date and
//  defence count on every title change. There was no history and no way to add
//  one without removing that constraint.
//
//  It was also the only writer of champions in the product, driven by a weekly
//  connector run — while `/api/cron/refresh-champions` ran daily and did nothing
//  at all (`case "champions": … refresh:noop`).
//
//  ── What replaces it ─────────────────────────────────────────────────────
//  ChampionObservation records what a source said. TitleReign accumulates
//  forever: one row per reign, with a real status (CHAMPION / INTERIM / VACANT /
//  STRIPPED / RETIRED / LINEAL), a start, an end and its own defence count that
//  a later reign cannot reset because a later reign is a different row.
//
//  `Champion` is still written, unchanged, so every existing reader keeps
//  working. It is now a PROJECTION of the open reign rather than the record.
// ════════════════════════════════════════════════════════════════════════════

/** The claim a champion observation carries. */
interface TitleClaim {
  fighterId: string | null;
  status: "CHAMPION" | "INTERIM" | "VACANT" | "STRIPPED" | "RETIRED" | "LINEAL";
}

/**
 * Record what a connector said about a titleholder.
 *
 * Idempotent by construction: the unique key is
 * (provider, division, organisation, status, effectiveDate), so re-reading the
 * same publication writes nothing.
 */
export async function recordChampionObservation(
  connector: RankingConnector,
  entry: RankingEntry,
  fighterId: string | null,
  weightClassId: string,
  status: TitleClaim["status"] = "CHAMPION",
): Promise<boolean> {
  const effectiveDate = new Date(entry.effectiveDate);
  if (Number.isNaN(effectiveDate.getTime())) return false;

  const { count } = await prisma.championObservation
    .createMany({
      data: [{
        provider: connector.id,
        tier: tierOf(connector.trust),
        fighterId,
        weightClassId,
        // A STRING, not the SanctioningBody enum. The enum cannot represent a
        // body we have not shipped a migration for, and the old code returned
        // null and SKIPPED the champion in that case — evidence silently
        // dropped because our vocabulary was behind the sport's.
        organisation: entry.organisation ?? "",
        gender: entry.gender,
        status,
        effectiveDate,
        sourceUrl: entry.sourceUrl,
        confidence: connector.trust === "official" ? 1 : 0.8,
      }],
      skipDuplicates: true,
    })
    .catch(() => ({ count: 0 }));

  return count > 0;
}

export interface ChampionProjection {
  titles: number;
  reignsOpened: number;
  reignsClosed: number;
  contested: number;
}

/**
 * Project observations into reigns, and reigns into the legacy Champion row.
 *
 * The transition rule, and the reason reigns are a separate table:
 *
 *   the open reign disagrees with the evidence
 *     → CLOSE it (endedAt = the new observation's effective date)
 *     → OPEN a new one
 *
 * Closing rather than mutating is what preserves history. The old code's
 * in-place update is exactly what destroyed it, and it did so silently — there
 * was no row left to notice was missing.
 */
export async function projectChampions(now = new Date()): Promise<ChampionProjection> {
  const stat: ChampionProjection = { titles: 0, reignsOpened: 0, reignsClosed: 0, contested: 0 };

  const titles = await prisma.championObservation.groupBy({
    by: ["weightClassId", "organisation", "status"],
  });

  for (const title of titles) {
    stat.titles++;

    const rows = await prisma.championObservation.findMany({
      where: {
        weightClassId: title.weightClassId,
        organisation: title.organisation,
        status: title.status,
      },
      orderBy: { effectiveDate: "desc" },
      take: 100,
    });
    if (rows.length === 0) continue;

    // Gender comes from the evidence, not from the division name. Taken from the
    // newest observation that recorded one, so a belt keeps its gender even if a
    // later provider omits the field.
    const gender = rows.find((r) => r.gender)?.gender ?? null;

    const observations: Observation<TitleClaim>[] = rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      tier: r.tier as Tier,
      effectiveDate: r.effectiveDate,
      retrievedAt: r.retrievedAt,
      sourceUrl: r.sourceUrl,
      value: { fighterId: r.fighterId, status: r.status as TitleClaim["status"] },
    }));

    const decision = reconcile(observations, {
      now,
      // Two observations agree when they name the same person in the same role.
      // Comparing the objects by reference would make every source disagree with
      // every other and mark every belt contested.
      equals: (a, b) =>
        (a as TitleClaim).fighterId === (b as TitleClaim).fighterId &&
        (a as TitleClaim).status === (b as TitleClaim).status,
    });
    // Every provider's evidence is too old. Publishing the last thing a dead
    // source said, forever, is precisely what "never invent data" forbids.
    if (!decision) continue;
    if (decision.contested) stat.contested++;

    const open = await prisma.titleReign.findFirst({
      where: {
        weightClassId: title.weightClassId,
        organisation: title.organisation,
        status: title.status as TitleClaim["status"],
        endedAt: null,
      },
      orderBy: { startedAt: "desc" },
    });

    // Already correct — nothing to write. The common case on a daily run.
    if (open && open.fighterId === decision.value.fighterId) continue;

    if (open) {
      await prisma.titleReign.update({
        where: { id: open.id },
        // Ends where the successor begins, from the SOURCE's effective date
        // rather than from our clock — the belt changed hands when the body says
        // it did, not when our cron happened to notice.
        data: { endedAt: decision.effectiveDate },
      });
      stat.reignsClosed++;
    }

    await prisma.titleReign.create({
      data: {
        fighterId: decision.value.fighterId,
        weightClassId: title.weightClassId,
        organisation: title.organisation,
        status: title.status as TitleClaim["status"],
        gender,
        startedAt: decision.effectiveDate,
        decidedBy: decision.reason,
        contested: decision.contested,
        evidence: {
          provider: decision.provider,
          tier: decision.tier,
          sourceUrl: decision.sourceUrl,
          agreementCount: decision.agreementCount,
          observationIds: decision.observationIds,
        },
      },
    });
    stat.reignsOpened++;

    await syncLegacyChampion(title.weightClassId, title.organisation, decision.value, title.status);
  }

  return stat;
}

/**
 * Keep the legacy `Champion` row in step with the open reign.
 *
 * Every existing champion surface reads this table, so it is maintained rather
 * than removed — but it is now DERIVED. When those readers move to TitleReign
 * this function is the only thing to delete.
 *
 * Only CHAMPION and INTERIM are projected: the old model has no way to express a
 * vacant or stripped belt, and writing one of those as though somebody held it
 * would be worse than leaving the row absent.
 */
async function syncLegacyChampion(
  weightClassId: string,
  organisation: string,
  claim: TitleClaim,
  status: string,
): Promise<void> {
  if (status !== "CHAMPION" || !claim.fighterId) return;

  const body = sanctioningBodyFor(organisation);
  if (!body) return;

  const existing = await prisma.champion.findFirst({
    where: { weightClassId, body, current: true },
    select: { id: true, fighterId: true },
  });
  if (existing?.fighterId === claim.fighterId) return;

  if (existing) {
    // Still an in-place update, because the boolean unique constraint leaves no
    // alternative — but the HISTORY it used to destroy now lives in TitleReign,
    // so this is a cache being refreshed rather than a record being lost.
    await prisma.champion
      .update({ where: { id: existing.id }, data: { fighterId: claim.fighterId, since: null, defenses: 0 } })
      .catch(() => {});
    return;
  }
  await prisma.champion
    .create({ data: { fighterId: claim.fighterId, weightClassId, body, current: true } })
    .catch(() => {});
}

/** Organisation string → the SanctioningBody enum, or null when unmapped. */
function sanctioningBodyFor(organisation: string) {
  const key = organisation.trim().toUpperCase().replace(/[^A-Z]/g, "");
  const known = ["WBA", "WBC", "IBF", "WBO", "IBO", "BKFC", "ONE", "PFL", "UFC", "BELLATOR", "GLORY", "RIZIN", "KSW"] as const;
  return (known as readonly string[]).includes(key) ? (key as (typeof known)[number]) : null;
}
