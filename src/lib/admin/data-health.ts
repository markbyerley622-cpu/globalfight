import "server-only";
import { prisma } from "@/lib/db";
import { PUBLIC_EVENT } from "@/lib/events-visibility";
import { RANKING_SOURCES } from "@/lib/rankings/sources";
import { toCountryCode } from "@/lib/countries";

// ════════════════════════════════════════════════════════════════════════
//  Data Health audit — turns data quality from a game of discovery into a
//  measurable, actionable report. Every check is a COUNT plus a handful of
//  linked samples so an operator can go straight to the fix. Read-only.
//
//  "Critical" = a gap a user sees right now (a card fighter with no photo, a
//  duplicate fighter). "Warn" = degraded but self-healing (falls back to
//  generated art). "Info" = completeness gaps worth backfilling.
// ════════════════════════════════════════════════════════════════════════

export type Severity = "critical" | "warn" | "info";

export interface Sample { label: string; href: string }

export interface HealthCheck {
  id: string;
  label: string;
  count: number;
  severity: Severity;
  hint: string;
  samples: Sample[];
}

export interface DataHealthReport {
  generatedAt: string;
  totals: { fighters: number; events: number; rankings: number };
  checks: HealthCheck[];
}

const NO_PHOTO = { photoUrl: null, imageUrl: null, thumbUrl: null } as const;
const UPCOMING = { date: { gte: new Date() }, status: { notIn: ["COMPLETED", "CANCELLED", "DRAFT"] as never } };
const onUpcoming = { some: { event: UPCOMING } };

/** Known ranking sources — anything else is un-provenanced. */
const KNOWN_SOURCES = new Set<string>([...RANKING_SOURCES.map((s) => s.id), "generated", "curated", "manual"]);

async function fighterSamples(where: object): Promise<Sample[]> {
  const rows = await prisma.fighter.findMany({ where, select: { slug: true, name: true }, take: 8, orderBy: { name: "asc" } });
  return rows.map((f) => ({ label: f.name, href: `/fighters/${f.slug}` }));
}
async function eventSamples(where: object): Promise<Sample[]> {
  const rows = await prisma.event.findMany({ where, select: { id: true, slug: true, name: true }, take: 8, orderBy: { date: "asc" } });
  return rows.map((e) => ({ label: e.name, href: `/admin/events/${e.id}` }));
}

/** Run the full audit. Counts are cheap; samples are capped at 8 per check. */
export async function auditDataHealth(): Promise<DataHealthReport> {
  const [fighters, events, rankings] = await Promise.all([
    prisma.fighter.count(),
    prisma.event.count({ where: PUBLIC_EVENT }),
    prisma.ranking.count(),
  ]);

  const checks: HealthCheck[] = [];
  const push = async (
    id: string, label: string, severity: Severity, hint: string,
    where: object, kind: "fighter" | "event",
  ) => {
    const count = kind === "fighter" ? await prisma.fighter.count({ where }) : await prisma.event.count({ where });
    if (count === 0) return;
    const samples = kind === "fighter" ? await fighterSamples(where) : await eventSamples(where);
    checks.push({ id, label, count, severity, hint, samples });
  };

  // ── Fighters ────────────────────────────────────────────────────────────
  await push(
    "card-fighters-no-photo", "Upcoming-card fighters with no photo", "critical",
    "These appear on event cards right now with a gradient instead of a face. Run enrich (prioritises upcoming fighters).",
    { ...NO_PHOTO, OR: [{ fightsAsRed: onUpcoming }, { fightsAsBlue: onUpcoming }] }, "fighter",
  );
  await push(
    "fighters-no-photo", "Fighters with no photo", "warn",
    "No own/licensed photo. Enrich pulls a Commons photo where one exists.",
    NO_PHOTO, "fighter",
  );
  await push(
    "fighters-no-record", "Fighters with an empty record", "warn",
    "0-0-0 — unrankable by the rating engine and shows no record. Needs results import.",
    { wins: 0, losses: 0, draws: 0 }, "fighter",
  );
  await push(
    "fighters-no-country", "Fighters with no country", "info",
    "No flag on cards/rankings. Backfill from enrichment or source data.",
    { countryCode: null }, "fighter",
  );

  // ── Events ──────────────────────────────────────────────────────────────
  await push(
    "events-no-art", "Upcoming events with no poster/hero", "warn",
    "Falls back to generated poster art (fine, but official artwork is better). Backfill posterUrl/heroUrl.",
    { ...PUBLIC_EVENT, ...UPCOMING, posterUrl: null, heroUrl: null }, "event",
  );
  await push(
    "events-no-venue", "Upcoming events with no venue", "info",
    "No venue line / map pin. Backfill venue + city.",
    { ...PUBLIC_EVENT, ...UPCOMING, venue: null }, "event",
  );

  // ── Unresolved countries (would render a blank flag) ─────────────────────
  const codeGroups = await prisma.fighter.groupBy({ by: ["countryCode"], where: { countryCode: { not: null } }, _count: { countryCode: true } });
  const unresolved = codeGroups.filter((g) => g.countryCode && !toCountryCode(g.countryCode));
  if (unresolved.length > 0) {
    checks.push({
      id: "unresolved-countries", label: "Fighters with an unresolvable country", severity: "warn",
      count: unresolved.reduce((n, g) => n + g._count.countryCode, 0),
      hint: "These country values don't map to an ISO-2 flag — add the alias/code to lib/countries so the resolver handles them (never patch one card).",
      samples: unresolved.slice(0, 10).map((g) => ({ label: `${g.countryCode} (${g._count.countryCode})`, href: `/fighters?country=${encodeURIComponent(g.countryCode ?? "")}` })),
    });
  }

  // ── News ────────────────────────────────────────────────────────────────
  const articlesTotal = await prisma.article.count();
  const articlesNoImage = await prisma.article.count({
    where: { coverImageUrl: null, OR: [{ ogImageUrl: null }, { ogImageUrl: "none" }] },
  });
  if (articlesNoImage > 0) {
    const pct = articlesTotal ? Math.round((articlesNoImage / articlesTotal) * 100) : 0;
    const recent = await prisma.article.findMany({
      where: { coverImageUrl: null, OR: [{ ogImageUrl: null }, { ogImageUrl: "none" }] },
      select: { slug: true, title: true }, take: 8, orderBy: { publishedAt: "desc" },
    });
    checks.push({
      id: "articles-no-image", label: "Articles showing a generated placeholder", severity: "warn",
      count: articlesNoImage,
      hint: `${pct}% of articles have no real image (RSS carries none). Run "Article images" to fetch each one's OpenGraph image.`,
      samples: recent.map((a) => ({ label: a.title.slice(0, 40), href: `/news/${a.slug}` })),
    });
  }

  // ── Rankings ──────────────────────────────────────────────────────────────
  const unknownSourceRows = await prisma.ranking.groupBy({ by: ["source"], _count: { source: true } });
  const unprovenanced = unknownSourceRows.filter((r) => !KNOWN_SOURCES.has(r.source));
  if (unprovenanced.length > 0) {
    checks.push({
      id: "rankings-no-provenance", label: "Rankings from an unknown source", severity: "warn",
      count: unprovenanced.reduce((n, r) => n + r._count.source, 0),
      hint: "Source isn't in the connector registry — provenance can't be shown. Re-ingest from a registered connector.",
      samples: unprovenanced.slice(0, 8).map((r) => ({ label: `source: ${r.source || "(empty)"} (${r._count.source})`, href: "/admin/health" })),
    });
  }

  // ── Duplicates (raw: normalised name collisions) ─────────────────────────
  const dupFighters = await prisma.$queryRaw<{ key: string; n: bigint }[]>`
    SELECT lower(name) AS key, count(*) AS n FROM "Fighter" GROUP BY lower(name) HAVING count(*) > 1 ORDER BY count(*) DESC LIMIT 20`;
  if (dupFighters.length > 0) {
    checks.push({
      id: "duplicate-fighters", label: "Duplicate fighters (same name)", severity: "critical",
      count: dupFighters.reduce((n, r) => n + Number(r.n), 0),
      hint: "Same name, multiple records — splits rankings/records/history. Merge them (re-point fights, then delete).",
      samples: dupFighters.slice(0, 8).map((r) => ({ label: `${r.key} ×${Number(r.n)}`, href: `/fighters?q=${encodeURIComponent(r.key)}` })),
    });
  }

  const dupEvents = await prisma.$queryRaw<{ key: string; n: bigint }[]>`
    SELECT lower(name) AS key, count(*) AS n FROM "Event" WHERE status <> 'DRAFT' GROUP BY lower(name) HAVING count(*) > 1 ORDER BY count(*) DESC LIMIT 20`;
  if (dupEvents.length > 0) {
    checks.push({
      id: "duplicate-events", label: "Duplicate events (same name)", severity: "warn",
      count: dupEvents.reduce((n, r) => n + Number(r.n), 0),
      hint: "Same event name across records — usually a double-import. Verify and merge/delete.",
      samples: dupEvents.slice(0, 8).map((r) => ({ label: `${r.key} ×${Number(r.n)}`, href: "/admin/events" })),
    });
  }

  // Most severe first, then by size.
  const rank: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };
  checks.sort((a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count);

  return { generatedAt: new Date().toISOString(), totals: { fighters, events, rankings }, checks };
}
