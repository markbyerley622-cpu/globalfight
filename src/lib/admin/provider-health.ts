import "server-only";
import { prisma } from "@/lib/db";
import { flags } from "@/lib/feature-flags";
import { COVERAGE_LADDER, ladderSummary, type LadderEntry, type LadderStatus } from "@/lib/scraper/coverage-ladder";
import type { Sport } from "@/lib/types";

// ════════════════════════════════════════════════════════════════════════════
//  Provider health — what each ingestion source has actually DONE.
//
//  Three sports now run on one framework and more are coming, and the failure
//  mode is silence: adcombat.com began answering 403 and BJJ sat at ONE event
//  with nothing visibly wrong. The cron dashboard says a job ran; it cannot say
//  the job wrote nothing because its source is refusing us.
//
//  So this measures OUTCOMES, from the rows themselves — events written per
//  source, when it last wrote, how much of what it wrote is usable. A provider
//  that has not written in a month is the signal, and no amount of green cron
//  ticks substitutes for it.
// ════════════════════════════════════════════════════════════════════════════

/** How stale a source's newest write may be before it is a warning / a failure. */
const WARN_DAYS = 14;
const FAIL_DAYS = 45;

export type ProviderState = "healthy" | "stale" | "silent" | "disabled" | "never-run";

export interface ProviderRow {
  /** The `source` value its rows carry (EventExternalId.source). */
  source: string;
  label: string;
  sport: Sport | "multi";
  state: ProviderState;
  /** Feature-flag gate, when the provider has one. */
  enabled: boolean | null;
  events: number;
  bouts: number;
  /** Newest ingest by this source, ISO, or null if it has never written. */
  lastWriteAt: string | null;
  daysSinceWrite: number | null;
  /** Cards this source wrote that hold no bouts — its own quality signal. */
  emptyCards: number;
  note: string;
}

export interface ProviderHealthReport {
  generatedAt: string;
  /** ENABLE_SCRAPER — the master gate above every provider flag. */
  scraperEnabled: boolean;
  backfillEnabled: boolean;
  providers: ProviderRow[];
  ladder: LadderEntry[];
  ladderSummary: Record<LadderStatus, number>;
  coverage: { sport: string; events: number; bouts: number; withBouts: number }[];
  graph: GraphHealth;
}

/**
 * The canonical combat graph's completeness — launch-readiness telemetry.
 *
 * Ruleset coverage is the number that gates everything downstream: a discipline
 * is only as good as the bout evidence behind it, and an UNKNOWN bout is a
 * fighter who may be filed under the wrong sport. This is the screen that says
 * whether the graph is ready to be trusted by search and rankings.
 */
export interface GraphHealth {
  bouts: number;
  boutsWithRuleset: number;
  /** UNKNOWN bouts grouped by promotion — every gap with a name. */
  unknownByPromotion: { promotion: string; bouts: number }[];
  fighters: number;
  fightersCalculated: number;
  multiDiscipline: number;
  /** HIGH / MEDIUM / LOW / UNKNOWN counts. */
  tiers: { tier: string; fighters: number }[];
  /** Fighters per discipline; a crossover athlete counts in each. */
  perDiscipline: { sport: string; fighters: number }[];
}

async function getGraphHealth(): Promise<GraphHealth> {
  const [bouts, known, fighters, calculated, tierRows, unknownRows, fighterRows] = await Promise.all([
    prisma.fight.count(),
    prisma.fight.count({ where: { ruleset: { not: "UNKNOWN" } } }),
    prisma.fighter.count(),
    prisma.fighter.count({ where: { lastCalculatedAt: { not: null } } }),
    prisma.fighter.groupBy({ by: ["disciplineTier"], _count: { _all: true } }),
    prisma.fight.findMany({
      where: { ruleset: "UNKNOWN" },
      select: { event: { select: { promotion: true } } },
    }),
    // `sports` is an array column, so the distribution is counted in app code —
    // one read of a narrow projection rather than a query per discipline.
    prisma.fighter.findMany({ select: { sports: true } }),
  ]);

  const byPromo = new Map<string, number>();
  for (const f of unknownRows) {
    const p = f.event?.promotion ?? "(no event)";
    byPromo.set(p, (byPromo.get(p) ?? 0) + 1);
  }

  const perDiscipline = new Map<string, number>();
  let multi = 0;
  for (const f of fighterRows) {
    if (f.sports.length > 1) multi += 1;
    for (const s of f.sports) perDiscipline.set(s, (perDiscipline.get(s) ?? 0) + 1);
  }

  return {
    bouts,
    boutsWithRuleset: known,
    unknownByPromotion: [...byPromo]
      .map(([promotion, n]) => ({ promotion, bouts: n }))
      .sort((a, b) => b.bouts - a.bouts)
      .slice(0, 10),
    fighters,
    fightersCalculated: calculated,
    multiDiscipline: multi,
    tiers: tierRows
      .map((t) => ({ tier: t.disciplineTier ?? "(not calculated)", fighters: t._count._all }))
      .sort((a, b) => b.fighters - a.fighters),
    perDiscipline: [...perDiscipline]
      .map(([sport, n]) => ({ sport, fighters: n }))
      .sort((a, b) => b.fighters - a.fighters),
  };
}

/** The sources we expect to see, with the flag that gates each. */
const KNOWN: Array<{ source: string; label: string; sport: Sport | "multi"; flag?: keyof ReturnType<typeof flags>; note: string }> = [
  { source: "wikipedia-category", label: "Boxing — Wikipedia categories", sport: "BOXING", flag: "boxingProviderEnabled", note: "Per-fight articles discovered by year category." },
  { source: "wikipedia-year", label: "ONE / GLORY — year round-ups", sport: "multi", note: "Sport is derived per card from bout rulesets." },
  { source: "wikipedia-index", label: "Misfits — promotion index", sport: "BOXING", note: "Index article to per-card articles." },
  { source: "wikipedia", label: "Wikipedia cards (results harvest)", sport: "multi", note: "The only bout-RESULTS source for several promotions." },
  { source: "espn", label: "ESPN scoreboard", sport: "MMA", note: "UFC / PFL / Bellator / ONE / RIZIN." },
  { source: "bkfc", label: "BKFC", sport: "BARE_KNUCKLE", note: "Official site — events, cards and fighters." },
  {
    source: "bkfc-results", label: "BKFC scored cards (MMAReg)", sport: "BARE_KNUCKLE",
    flag: "bkfcResultsEnabled",
    note: "BLOCKED ON COMPLIANCE, not capability: connector is complete and measured (207/207 " +
      "sampled bouts decided), but MMAReg is a commercial data vendor with no basis recorded. " +
      "Results meanwhile come from the Wikipedia path.",
  },
  { source: "one", label: "ONE Championship (official)", sport: "multi", flag: "muayThaiProviderEnabled", note: "Official event pages." },
  { source: "adcc", label: "ADCC (adcombat.com)", sport: "BJJ", flag: "bjjProviderEnabled", note: "Source answered HTTP 403 on 2026-08-02 — see the ladder." },
  // Both of these were WRITING ROWS while unregistered, so the dashboard flagged
  // them with its own "add it to KNOWN" note on every run. An unregistered writer
  // is worse than a missing one: it has no `state`, so it can go silent for weeks
  // without ever being counted as silent.
  {
    source: "wikipedia-tournament", label: "Federation tournaments (Wikipedia)", sport: "multi",
    note: "Bracket sports — wrestling / judo / taekwondo have full trees; sambo and BJJ are medal-table only.",
  },
  {
    source: "matchroom", label: "Matchroom Boxing", sport: "BOXING",
    note: "Card discovery only; bouts arrive via the Wikipedia results harvest.",
  },
];

const days = (from: Date): number => Math.floor((Date.now() - from.getTime()) / 86_400_000);

function classify(enabled: boolean | null, events: number, since: number | null): ProviderState {
  if (enabled === false) return "disabled";
  if (events === 0 || since === null) return "never-run";
  if (since > FAIL_DAYS) return "silent";
  if (since > WARN_DAYS) return "stale";
  return "healthy";
}

export async function getProviderHealth(): Promise<ProviderHealthReport> {
  const f = flags();

  // One grouped query rather than one per provider.
  const grouped = await prisma.eventExternalId.groupBy({
    by: ["source"],
    _count: { _all: true },
    _max: { createdAt: true },
  });
  const bySource = new Map(grouped.map((g) => [g.source, g]));

  const providers: ProviderRow[] = [];
  for (const k of KNOWN) {
    const g = bySource.get(k.source);
    const events = g?._count._all ?? 0;
    const last = g?._max.createdAt ?? null;
    const since = last ? days(last) : null;
    const enabled = k.flag ? (f[k.flag] as boolean) : null;

    // Bouts and empty cards for this source's events, scoped by the link table.
    const [bouts, emptyCards] = events
      ? await Promise.all([
          prisma.fight.count({ where: { event: { externalIds: { some: { source: k.source } } } } }),
          prisma.event.count({ where: { externalIds: { some: { source: k.source } }, fights: { none: {} } } }),
        ])
      : [0, 0];

    providers.push({
      source: k.source,
      label: k.label,
      sport: k.sport,
      state: classify(enabled, events, since),
      enabled,
      events,
      bouts,
      lastWriteAt: last ? last.toISOString() : null,
      daysSinceWrite: since,
      emptyCards,
      note: k.note,
    });
  }

  // Any source writing rows that is NOT in the list above — a provider someone
  // added without registering it here shows up rather than hiding.
  for (const g of grouped) {
    if (KNOWN.some((k) => k.source === g.source)) continue;
    const since = g._max.createdAt ? days(g._max.createdAt) : null;
    providers.push({
      source: g.source,
      label: `${g.source} (unregistered)`,
      sport: "multi",
      state: classify(null, g._count._all, since),
      enabled: null,
      events: g._count._all,
      bouts: 0,
      lastWriteAt: g._max.createdAt ? g._max.createdAt.toISOString() : null,
      daysSinceWrite: since,
      emptyCards: 0,
      note: "Writing rows but not registered in provider-health. Add it to KNOWN.",
    });
  }

  // Coverage per sport, so the dashboard answers "did that provider move the
  // number?" without a second screen.
  const [bySport, withBouts] = await Promise.all([
    prisma.event.groupBy({ by: ["sport"], _count: { _all: true } }),
    prisma.event.findMany({ where: { fights: { some: {} } }, select: { sport: true } }),
  ]);
  const withBoutsBySport = new Map<string, number>();
  for (const e of withBouts) withBoutsBySport.set(e.sport, (withBoutsBySport.get(e.sport) ?? 0) + 1);

  const coverage = await Promise.all(
    bySport.map(async (s) => ({
      sport: s.sport,
      events: s._count._all,
      bouts: await prisma.fight.count({ where: { event: { sport: s.sport } } }),
      withBouts: withBoutsBySport.get(s.sport) ?? 0,
    })),
  );
  coverage.sort((a, b) => b.events - a.events);

  return {
    generatedAt: new Date().toISOString(),
    scraperEnabled: process.env.ENABLE_SCRAPER === "true",
    backfillEnabled: f.providerBackfillEnabled,
    providers: providers.sort((a, b) => b.events - a.events),
    ladder: COVERAGE_LADDER,
    ladderSummary: ladderSummary(),
    coverage,
    graph: await getGraphHealth(),
  };
}
