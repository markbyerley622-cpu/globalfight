import "server-only";
import { prisma } from "@/lib/db";

// ════════════════════════════════════════════════════════════════════════════
//  ACCURACY, not completeness.
//
//  audit:quality answers "how much data is there?". This answers the harder
//  question: "is what we PUBLISH correct, and can it prove it?"
//
//  ── What prompted it ─────────────────────────────────────────────────────
//  A report that every boxing champion on the site is a woman. That reads like a
//  gender-filter bug, and it is not one — it is a COVERAGE fact wearing a bug's
//  clothes, and no existing tool could tell the two apart. Every check below
//  exists to make that distinction visible without anyone having to read the
//  connector registry.
//
//  ── The rule ─────────────────────────────────────────────────────────────
//  Every published row must be traceable to evidence. A row with no observation
//  behind it is not "probably fine" — it is unexplainable, which after this
//  sprint's architecture means it predates the evidence layer or was written by
//  something that should not have written it.
// ════════════════════════════════════════════════════════════════════════════

export type RankingIssue =
  /** Published, with no observation behind it. Cannot explain itself. */
  | "no_evidence"
  /** Never reconciled, or not since the staleness ceiling. */
  | "stale"
  /** Two fighters share a rank in one list. Legitimate for a 2-way tie only. */
  | "duplicate_rank"
  /** The list skips a position — 1,2,4. Usually a parse that dropped a row. */
  | "rank_gap"
  /** One division carries rows of more than one gender. */
  | "mixed_gender"
  /** The winning provider is not in the provider registry. */
  | "unknown_provider";

export interface ListAudit {
  organisation: string;
  division: string;
  isPoundForPound: boolean;
  /** From the rows' own gender, falling back to the division-name convention. */
  gender: string;
  rows: number;
  /** The provider that decided this list, from the projection. */
  provider: string | null;
  tier: string | null;
  effectiveDate: string | null;
  sourceUrl: string | null;
  confidence: number | null;
  reconciledAt: string | null;
  agreementCount: number;
  contested: boolean;
  issues: RankingIssue[];
}

export interface CoverageBySport {
  sport: string;
  organisations: string[];
  /** How many published rows are men's / women's / unknown. */
  male: number;
  female: number;
  unknown: number;
  note: string;
}

export interface RankingAccuracyReport {
  generatedAt: string;
  lists: ListAudit[];
  coverage: CoverageBySport[];
  totals: { lists: number; rows: number; withIssues: number };
}

const STALE_DAYS = 14;

/** The division-name convention, used only when the row has no stored gender. */
const genderFromName = (division: string): string =>
  /^women'?s\b/i.test(division) ? "female" : "unknown";

export async function auditRankingAccuracy(now = new Date()): Promise<RankingAccuracyReport> {
  const staleBefore = new Date(now.getTime() - STALE_DAYS * 86_400_000);

  const rows = await prisma.ranking.findMany({
    select: {
      id: true, rank: true, organisation: true, isPoundForPound: true,
      source: true, tier: true, gender: true, effectiveDate: true, sourceUrl: true,
      confidence: true, reconciledAt: true, agreementCount: true, contested: true,
      observationIds: true,
      weightClass: { select: { name: true, sport: true } },
    },
    orderBy: [{ organisation: "asc" }, { rank: "asc" }],
  });

  const knownProviders = new Set(
    (await prisma.rankingObservation.findMany({ select: { provider: true }, distinct: ["provider"] }).catch(() => []))
      .map((o) => o.provider),
  );

  // Group into LISTS — the unit a ranking is actually published as.
  const lists = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.organisation}|${r.weightClass.name}|${r.isPoundForPound}`;
    lists.set(key, [...(lists.get(key) ?? []), r]);
  }

  const audits: ListAudit[] = [];
  for (const group of lists.values()) {
    const head = group[0];
    const division = head.weightClass.name;
    const issues: RankingIssue[] = [];

    // Gender: the STORED value first, the name convention only as a fallback.
    // The convention is what both current connectors happen to follow; it is not
    // enforced anywhere, which is exactly why the column now exists.
    const genders = new Set(group.map((r) => r.gender ?? genderFromName(division)));
    if (genders.size > 1) issues.push("mixed_gender");

    if (group.every((r) => r.observationIds.length === 0)) issues.push("no_evidence");
    if (group.every((r) => !r.reconciledAt || r.reconciledAt < staleBefore)) issues.push("stale");

    // A 2-way tie is legitimate (bodies really do rank two fighters equal); the
    // same rank three or more times is parse drift, the same rule the UFC
    // connector's own validator applies before publishing.
    const byRank = new Map<number, number>();
    for (const r of group) byRank.set(r.rank, (byRank.get(r.rank) ?? 0) + 1);
    if ([...byRank.values()].some((n) => n >= 3)) issues.push("duplicate_rank");

    const ranks = [...byRank.keys()].sort((a, b) => a - b);
    if (ranks.length > 2 && ranks[ranks.length - 1] > ranks.length + 1) issues.push("rank_gap");

    if (head.source && knownProviders.size > 0 && !knownProviders.has(head.source)) {
      issues.push("unknown_provider");
    }

    audits.push({
      organisation: head.organisation || "(cross-promotional)",
      division,
      isPoundForPound: head.isPoundForPound,
      gender: [...genders].join("+"),
      rows: group.length,
      provider: head.source ?? null,
      tier: head.tier ?? null,
      effectiveDate: head.effectiveDate?.toISOString().slice(0, 10) ?? null,
      sourceUrl: head.sourceUrl ?? null,
      confidence: head.confidence ?? null,
      reconciledAt: head.reconciledAt?.toISOString().slice(0, 16).replace("T", " ") ?? null,
      agreementCount: head.agreementCount,
      contested: head.contested,
      issues,
    });
  }

  // ── Coverage by sport and gender ────────────────────────────────────────
  // The check that answers "why is every boxing champion a woman?" without
  // anyone reading the connector registry: it shows, per sport, which
  // organisations we ingest and how the published rows split by gender.
  const bySport = new Map<string, { orgs: Set<string>; male: number; female: number; unknown: number }>();
  for (const r of rows) {
    const sport = r.weightClass.sport;
    const bucket = bySport.get(sport) ?? { orgs: new Set<string>(), male: 0, female: 0, unknown: 0 };
    if (r.organisation) bucket.orgs.add(r.organisation);
    const g = r.gender ?? genderFromName(r.weightClass.name);
    if (g === "male") bucket.male++;
    else if (g === "female") bucket.female++;
    else bucket.unknown++;
    bySport.set(sport, bucket);
  }

  const coverage: CoverageBySport[] = [...bySport.entries()].map(([sport, b]) => ({
    sport,
    organisations: [...b.orgs].sort(),
    male: b.male,
    female: b.female,
    unknown: b.unknown,
    note: noteFor(b),
  }));

  return {
    generatedAt: now.toISOString(),
    lists: audits.sort((a, b) => b.issues.length - a.issues.length || a.organisation.localeCompare(b.organisation)),
    coverage: coverage.sort((a, b) => a.sport.localeCompare(b.sport)),
    totals: {
      lists: audits.length,
      rows: rows.length,
      withIssues: audits.filter((a) => a.issues.length > 0).length,
    },
  };
}

function noteFor(b: { male: number; female: number; unknown: number }): string {
  const total = b.male + b.female + b.unknown;
  if (total === 0) return "No published rankings.";

  // ── UNKNOWN IS NOT ZERO ─────────────────────────────────────────────────
  // The first version tested `female > 0 && male === 0` and concluded "every row
  // is a women's ranking". For MMA that was FALSE and confidently so: the UFC
  // connector publishes both, but rows written before the gender column exists
  // count as `unknown`, not as `male` — so the men's rows were invisible to the
  // test and the report accused a healthy source of a coverage gap.
  //
  // Absence of evidence, stated as evidence of absence. The whole point of this
  // audit is to stop doing that, so it must not do it itself.
  if (b.unknown === total) return "Gender not recorded on any row (pre-dates the gender column).";
  if (b.unknown > 0) {
    return `${b.male} men's · ${b.female} women's · ${b.unknown} not yet recorded — re-run after the next ingest before reading anything into the split.`;
  }

  if (b.female > 0 && b.male === 0) {
    // The exact sentence someone needs when they open the site and see only
    // women's champions. It is not a bug report — it is the coverage.
    return "EVERY published row is a women's ranking — no men's source is ingested for this sport.";
  }
  if (b.male > 0 && b.female === 0) return "Men's rankings only — no women's source is ingested.";
  return `${b.male} men's · ${b.female} women's.`;
}

// ─── Champions ──────────────────────────────────────────────────────────────

export type ChampionIssue =
  /** A legacy Champion row with no TitleReign behind it. */
  | "no_reign"
  /** A reign with no recorded evidence — cannot say which source decided it. */
  | "no_evidence"
  /** Providers disagreed and the tier order broke the tie. */
  | "contested"
  /** The belt is held but the organisation publishes no ranking we ingest. */
  | "no_ranking_source";

export interface ChampionAudit {
  organisation: string;
  division: string;
  gender: string;
  fighter: string | null;
  status: string;
  since: string | null;
  provider: string | null;
  sourceUrl: string | null;
  issues: ChampionIssue[];
}

export interface ChampionAccuracyReport {
  generatedAt: string;
  champions: ChampionAudit[];
  /** Legacy Champion rows with no matching open reign — the migration gap. */
  legacyOnly: number;
  totals: { champions: number; withIssues: number };
}

export async function auditChampionAccuracy(now = new Date()): Promise<ChampionAccuracyReport> {
  const [reigns, legacy, rankingOrgs] = await Promise.all([
    prisma.titleReign
      .findMany({
        where: { endedAt: null },
        select: {
          organisation: true, status: true, startedAt: true, gender: true,
          decidedBy: true, evidence: true, contested: true,
          fighter: { select: { name: true } },
          weightClass: { select: { name: true } },
        },
      })
      .catch(() => []),
    prisma.champion
      .findMany({
        where: { current: true },
        select: {
          body: true,
          fighter: { select: { name: true } },
          weightClass: { select: { name: true } },
        },
      })
      .catch(() => []),
    prisma.ranking
      .findMany({ where: { organisation: { not: "" } }, select: { organisation: true }, distinct: ["organisation"] })
      .catch(() => []),
  ]);

  const orgsWithRankings = new Set(rankingOrgs.map((r) => r.organisation.toUpperCase()));

  const champions: ChampionAudit[] = reigns.map((r) => {
    const issues: ChampionIssue[] = [];
    const evidence = (r.evidence ?? null) as { provider?: string; sourceUrl?: string } | null;
    if (!evidence?.provider) issues.push("no_evidence");
    if (r.contested) issues.push("contested");
    if (!orgsWithRankings.has(r.organisation.toUpperCase())) issues.push("no_ranking_source");

    return {
      organisation: r.organisation,
      division: r.weightClass.name,
      gender: r.gender ?? genderFromName(r.weightClass.name),
      fighter: r.fighter?.name ?? null,
      status: r.status,
      since: r.startedAt.toISOString().slice(0, 10),
      provider: evidence?.provider ?? null,
      sourceUrl: evidence?.sourceUrl ?? null,
      issues,
    };
  });

  // Legacy rows the reign table does not yet cover. Before this sprint's
  // projection has run, that is ALL of them — which is a migration state, not a
  // fault, and the report says so rather than flagging every belt as broken.
  const covered = new Set(champions.map((c) => `${c.organisation.toUpperCase()}|${c.division}`));
  const legacyOnly = legacy.filter((l) => !covered.has(`${l.body}|${l.weightClass.name}`)).length;

  for (const l of legacy) {
    if (covered.has(`${l.body}|${l.weightClass.name}`)) continue;
    champions.push({
      organisation: l.body,
      division: l.weightClass.name,
      gender: genderFromName(l.weightClass.name),
      fighter: l.fighter?.name ?? null,
      status: "CHAMPION",
      since: null,
      provider: null,
      sourceUrl: null,
      issues: ["no_reign"],
    });
  }

  return {
    generatedAt: now.toISOString(),
    champions: champions.sort((a, b) => b.issues.length - a.issues.length || a.organisation.localeCompare(b.organisation)),
    legacyOnly,
    totals: { champions: champions.length, withIssues: champions.filter((c) => c.issues.length > 0).length },
  };
}
