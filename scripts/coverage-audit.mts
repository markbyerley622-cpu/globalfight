// PHASE 1 — the measured coverage report. Read-only, no network, no estimates.
//
//   npm run coverage:audit
//   npm run coverage:audit -- --json     # machine-readable
//
// Everything here is counted from the database. Nothing is inferred, and the
// three failure categories are kept apart on purpose:
//
//   SOURCE LACKS DATA   — we asked and the source has nothing. Not fixable by us.
//   PARSER FAILED       — we fetched a page and could not read it. Ours to fix.
//   PERSISTENCE FAILED  — we read it and could not write it. Ours to fix.
//
// Collapsing those into one "missing" number is how a parser bug gets reported
// as a source limitation and never gets fixed.
import { prisma } from "../src/lib/db.ts";
import { resolvePromotion, PROMOTIONS } from "../src/lib/promotions.ts";
import { STATIC_IMPORT_SOURCES, supportsLiveResultUpdates } from "../src/lib/scraper/source-policy.ts";
import { isSyntheticEventName } from "../src/lib/scraper/wikicard/search-strategies.ts";

const asJson = process.argv.includes("--json");
const now = new Date();

// ── raw rows ────────────────────────────────────────────────────────────────
const events = await prisma.event.findMany({
  select: {
    id: true, name: true, sport: true, promotion: true, date: true, status: true,
    posterUrl: true, heroUrl: true,
    resultsCompleteAt: true, resultsTerminalReason: true, resultAttemptAt: true, resultAttemptReason: true,
    externalIds: { select: { source: true } },
    _count: { select: { fights: true } },
  },
});

const boutRows = await prisma.$queryRaw<
  { eventId: string; bouts: bigint; decided: bigint }[]
>`
  SELECT "eventId", COUNT(*) AS bouts, COUNT(*) FILTER (WHERE result <> 'SCHEDULED') AS decided
  FROM "Fight" WHERE "eventId" IS NOT NULL GROUP BY "eventId"
`;
const bouts = new Map(boutRows.map((r) => [r.eventId, { bouts: Number(r.bouts), decided: Number(r.decided) }]));

// Fighters, attributed to a promotion via the events they fought on. A fighter
// on two promotions' cards counts under both — this measures "does this
// promotion's roster have faces", not a global unique count.
const fighterRows = await prisma.$queryRaw<
  { promotion: string | null; total: bigint; withImage: bigint }[]
>`
  SELECT COALESCE(e.promotion, '— unattributed —') AS promotion,
         COUNT(DISTINCT fr.id)                     AS total,
         COUNT(DISTINCT fr.id) FILTER (
           WHERE fr."imageUrl" IS NOT NULL OR fr."thumbUrl" IS NOT NULL OR fr."photoUrl" IS NOT NULL
         )                                          AS "withImage"
  FROM "Event" e
  JOIN "Fight" f  ON f."eventId" = e.id
  JOIN "Fighter" fr ON fr.id = f."redId" OR fr.id = f."blueId"
  GROUP BY 1
`;
const fighters = new Map(
  fighterRows.map((r) => [r.promotion ?? "— unattributed —", { total: Number(r.total), withImage: Number(r.withImage) }]),
);

// ── group ───────────────────────────────────────────────────────────────────
interface Group {
  promotion: string;
  sports: Set<string>;
  sources: Set<string>;
  events: number;
  past: number;
  withBouts: number;
  empty: number;
  bouts: number;
  decided: number;
  missingEventImage: number;
  /** Past, non-cancelled events whose bouts are not all decided. */
  incomplete: number;
  complete: number;
  /** Past, undecided, and only one-shot sources cover it. Never queueable. */
  terminal: number;
  /** Empty past events, split by WHY. Never merged. */
  gap: { sourceLacks: number; parserFailed: number; neverAsked: number; synthetic: number };
}

const LIVE = { notIn: ["DRAFT", "CANCELLED", "POSTPONED"] };
const isLive = (s: string) => !["DRAFT", "CANCELLED", "POSTPONED"].includes(s);

const groups = new Map<string, Group>();
for (const ev of events) {
  const resolved = resolvePromotion(ev.promotion);
  const label = resolved.slug === "combat" ? (ev.promotion?.trim() || "— unattributed —") : resolved.name;

  const g = groups.get(label) ?? {
    promotion: label, sports: new Set(), sources: new Set(),
    events: 0, past: 0, withBouts: 0, empty: 0, bouts: 0, decided: 0,
    missingEventImage: 0, incomplete: 0, complete: 0, terminal: 0,
    gap: { sourceLacks: 0, parserFailed: 0, neverAsked: 0, synthetic: 0 },
  };

  g.sports.add(ev.sport);
  for (const x of ev.externalIds) g.sources.add(x.source);
  g.events += 1;
  if (!ev.posterUrl && !ev.heroUrl) g.missingEventImage += 1;

  const b = bouts.get(ev.id) ?? { bouts: 0, decided: 0 };
  g.bouts += b.bouts;
  g.decided += b.decided;
  if (b.bouts > 0) g.withBouts += 1;

  const past = ev.date < now && isLive(ev.status);
  if (past) {
    g.past += 1;
    // THREE states. Terminal is neither complete nor incomplete: the source is a
    // one-shot import and published no outcome for those bouts, so no cron will
    // ever change it. Counting it as incomplete made a fully-ingested taekwondo
    // corpus read as 19% "results" and buried the promotions actually behind.
    if (ev.resultsCompleteAt) g.complete += 1;
    else if (ev.resultsTerminalReason) g.terminal += 1;
    else g.incomplete += 1;

    if (b.bouts === 0) {
      g.empty += 1;
      // WHY is this past card empty? Three different answers, kept apart.
      const reason = (ev.resultAttemptReason ?? "").split(":")[0].trim();
      if (isSyntheticEventName(ev.name)) g.gap.synthetic += 1;
      else if (!ev.resultAttemptAt) g.gap.neverAsked += 1;
      else if (reason === "no_candidate" || reason === "all_rejected") g.gap.sourceLacks += 1;
      else g.gap.parserFailed += 1; // no_card / unverified / name_mismatch / error
    }
  }
  groups.set(label, g);
}

const rows = [...groups.values()].sort((a, b) => b.events - a.events);
const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);

// ── queue state ─────────────────────────────────────────────────────────────
const revisitable = {
  resultsCompleteAt: null,
  ...(STATIC_IMPORT_SOURCES.length
    ? { NOT: { externalIds: { some: { source: { in: STATIC_IMPORT_SOURCES } } } } }
    : {}),
};
const [queueableResult, queueableCard, parkedStatic, parkedComplete, unresolvedBouts] = await Promise.all([
  prisma.event.count({ where: { date: { lt: now }, status: LIVE, fights: { some: { result: "SCHEDULED" } }, ...revisitable } }),
  prisma.event.count({ where: { date: { lt: now }, status: LIVE, fights: { none: {} }, ...revisitable } }),
  prisma.event.count({
    where: { date: { lt: now }, fights: { some: { result: "SCHEDULED" } }, externalIds: { some: { source: { in: STATIC_IMPORT_SOURCES } } } },
  }),
  prisma.event.count({ where: { resultsCompleteAt: { not: null } } }),
  prisma.fight.count({ where: { result: "SCHEDULED", date: { lt: now }, event: { status: LIVE } } }),
]);

// ── promotion logos (registry, not the DB) ──────────────────────────────────
const promotionsInUse = new Set(
  events.map((e) => resolvePromotion(e.promotion).slug).filter((s) => s !== "combat"),
);
const missingLogos = PROMOTIONS.filter((p) => promotionsInUse.has(p.slug) && !p.logo).map((p) => p.slug);
const unregistered = [...groups.keys()].filter(
  (label) => label !== "— unattributed —" && !PROMOTIONS.some((p) => p.name === label),
);

if (asJson) {
  console.log(JSON.stringify({ rows: rows.map((r) => ({ ...r, sports: [...r.sports], sources: [...r.sources] })), queueableResult, queueableCard, parkedStatic, parkedComplete, unresolvedBouts, missingLogos, unregistered }, null, 2));
  await prisma.$disconnect();
  process.exit(0);
}

// ── render ──────────────────────────────────────────────────────────────────
const [conn] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
console.log(`database : ${conn.db}`);
console.log(`measured : ${now.toISOString()}`);

const COLS: { head: string; get: (r: Group) => string }[] = [
  { head: "sport", get: (r) => [...r.sports].join(",") },
  { head: "events", get: (r) => String(r.events) },
  { head: "past", get: (r) => String(r.past) },
  { head: "w/bouts", get: (r) => String(r.withBouts) },
  { head: "empty", get: (r) => String(r.empty) },
  { head: "bouts", get: (r) => String(r.bouts) },
  { head: "decided", get: (r) => String(r.decided) },
  { head: "noEvImg", get: (r) => String(r.missingEventImage) },
  { head: "noFtrImg", get: (r) => {
      const f = fighters.get(r.promotion);
      return f ? String(f.total - f.withImage) : "0";
    } },
  // Terminal cards are settled, not outstanding — they belong in the numerator.
  // The bare "complete/past" ratio reported a fully-ingested sport as 19%.
  { head: "results%", get: (r) => pct(r.complete + r.terminal, r.past) },
  { head: "term", get: (r) => String(r.terminal) },
  { head: "todo", get: (r) => String(r.incomplete) },
  { head: "source", get: (r) => ([...r.sources].join(",") || "—") },
];

const rendered = rows.map((r) => COLS.map((c) => c.get(r)));
const widths = COLS.map((c, i) => Math.max(c.head.length, ...rendered.map((x) => x[i].length)) + 2);
const nameW = Math.max(9, ...rows.map((r) => r.promotion.length)) + 2;

console.log("\n══ PROMOTION COVERAGE ═══════════════════════════════════════════════");
console.log("  " + "promotion".padEnd(nameW) + COLS.map((c, i) => c.head.padStart(widths[i])).join(""));
console.log("  " + "─".repeat(nameW + widths.reduce((a, b) => a + b, 0)));
rows.forEach((r, i) => {
  console.log("  " + r.promotion.padEnd(nameW) + rendered[i].map((s, j) => s.padStart(widths[j])).join(""));
});

const tot = rows.reduce((a, r) => ({
  events: a.events + r.events, past: a.past + r.past, withBouts: a.withBouts + r.withBouts,
  empty: a.empty + r.empty, bouts: a.bouts + r.bouts, decided: a.decided + r.decided,
  noImg: a.noImg + r.missingEventImage, complete: a.complete + r.complete,
}), { events: 0, past: 0, withBouts: 0, empty: 0, bouts: 0, decided: 0, noImg: 0, complete: 0 });
console.log("  " + "─".repeat(nameW + widths.reduce((a, b) => a + b, 0)));
console.log(
  `  ${"TOTAL".padEnd(nameW)}${"".padStart(widths[0])}${String(tot.events).padStart(widths[1])}` +
  `${String(tot.past).padStart(widths[2])}${String(tot.withBouts).padStart(widths[3])}` +
  `${String(tot.empty).padStart(widths[4])}${String(tot.bouts).padStart(widths[5])}` +
  `${String(tot.decided).padStart(widths[6])}${String(tot.noImg).padStart(widths[7])}` +
  `${"".padStart(widths[8])}${pct(tot.complete, tot.past).padStart(widths[9])}`,
);

console.log("\n══ RESULT QUEUE STATE ═══════════════════════════════════════════════");
console.log(`  queueable result refreshes  : ${queueableResult}   (past cards with an undecided bout, revisitable source)`);
console.log(`  queueable card backfills    : ${queueableCard}   (past cards with no bouts at all)`);
console.log(`  parked — static source      : ${parkedStatic}   (one-shot imports; supportsLiveResultUpdates=false)`);
console.log(`  parked — complete           : ${parkedComplete}   (resultsCompleteAt set; nothing left to learn)`);
console.log(`  genuinely unresolved bouts  : ${unresolvedBouts}   (past, undecided, on a live-status card)`);

console.log("\n══ WHERE THE REMAINING GAP COMES FROM ═══════════════════════════════");
console.log("  Empty PAST cards, by cause. These are different failures and are never merged.\n");
const causes = rows.filter((r) => r.empty > 0);
if (!causes.length) console.log("  none — every past card has bouts.");
for (const r of causes) {
  console.log(`  ${r.promotion}  (${r.empty} empty)`);
  if (r.gap.synthetic) console.log(`      ${String(r.gap.synthetic).padStart(4)}  SOURCE N/A     synthetic daily container — no upstream source indexes it`);
  if (r.gap.sourceLacks) console.log(`      ${String(r.gap.sourceLacks).padStart(4)}  SOURCE LACKS   asked, nothing plausible found upstream`);
  if (r.gap.parserFailed) console.log(`      ${String(r.gap.parserFailed).padStart(4)}  PARSER FAILED  page fetched and not readable — OURS to fix`);
  if (r.gap.neverAsked) console.log(`      ${String(r.gap.neverAsked).padStart(4)}  NOT YET ASKED  no harvest attempt recorded`);
}

console.log("\n══ SOURCE POLICY ════════════════════════════════════════════════════");
for (const s of [...new Set(rows.flatMap((r) => [...r.sources]))].sort()) {
  console.log(`  ${s.padEnd(24)} supportsLiveResultUpdates=${supportsLiveResultUpdates(s)}`);
}

console.log("\n══ PROMOTION LOGOS ══════════════════════════════════════════════════");
console.log(`  registry entries with a logo : ${PROMOTIONS.filter((p) => p.logo).length}/${PROMOTIONS.length}`);
console.log(`  in-use promotions missing a logo : ${missingLogos.length ? missingLogos.join(", ") : "none"}`);
console.log(`  promotions in the DB with NO registry entry (fall back to "Various"):`);
console.log(`      ${unregistered.length ? unregistered.join(", ") : "none"}`);

await prisma.$disconnect();
