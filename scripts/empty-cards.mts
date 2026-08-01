// Every past event with NO bouts, grouped by promotion, WITH A REASON.
//
//   npm run cards:empty                 # the report
//   npm run cards:empty -- --list       # every empty event, not just the totals
//   npm run cards:empty -- --promotion "pfl"
//
// The goal this serves: every historical event either has bouts, or has a
// documented reason why they cannot be obtained from the sources we have. A gap
// with a name is a decision; a gap without one is silent data loss.
//
// It writes nothing. It is the thing you run BEFORE deciding to build a scraper,
// so that the decision is made against the actual distribution of the gap rather
// than an assumed one.
import { prisma } from "../src/lib/db.ts";
import { resolvePromotion } from "../src/lib/promotions.ts";
import { isSyntheticEventName } from "../src/lib/scraper/wikicard/search-strategies.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string): string | undefined => {
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const parts: string[] = [];
  for (let j = i + 1; j < argv.length && !argv[j].startsWith("--"); j++) parts.push(argv[j]);
  return parts.length ? parts.join(" ") : undefined;
};

const promotionFilter = value("promotion");
const showList = flag("list");

/**
 * Why this card has no bouts. Ordered from "we know exactly" to "never looked".
 *
 * The distinction that matters is SYNTHETIC vs everything else. A synthetic card
 * ("Boxing — 26 Jul 2026", promotion "Various") is an internal container the odds
 * pipeline invents to hold a day's bouts; no external source has ever heard of
 * it. Its emptiness is not a scraping failure and no promotion scraper will ever
 * fill it — the bout is the unit upstream, not the card.
 */
type Reason =
  | "synthetic container"
  | "no source page found"
  | "page found, no card parsed"
  | "page found, not our bout"
  | "fetch error"
  | "attempted, other"
  | "never attempted";

function diagnose(ev: { name: string; resultAttemptAt: Date | null; resultAttemptReason: string | null }): Reason {
  if (isSyntheticEventName(ev.name)) return "synthetic container";
  if (!ev.resultAttemptAt) return "never attempted";
  const raw = (ev.resultAttemptReason ?? "").split(":")[0].trim();
  switch (raw) {
    case "no_candidate":
    case "all_rejected":
      return "no source page found";
    case "no_card":
      return "page found, no card parsed";
    case "unverified":
    case "name_mismatch":
      return "page found, not our bout";
    case "error":
      return "fetch error";
    default:
      return "attempted, other";
  }
}

const now = new Date();
const [conn] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
console.log(`database : ${conn.db}`);

const past = {
  date: { lt: now },
  status: { notIn: ["DRAFT", "CANCELLED", "POSTPONED"] as const },
};

const events = await prisma.event.findMany({
  where: past,
  select: {
    slug: true,
    name: true,
    sport: true,
    promotion: true,
    date: true,
    resultAttemptAt: true,
    resultAttempts: true,
    resultAttemptReason: true,
    _count: { select: { fights: true } },
  },
  orderBy: { date: "desc" },
});

interface Group {
  promotion: string;
  sport: Set<string>;
  total: number;
  empty: number;
  filled: number;
  reasons: Map<Reason, number>;
  examples: { name: string; date: Date; reason: Reason }[];
}

const groups = new Map<string, Group>();
for (const ev of events) {
  // "Various" is the placeholder for an unattributed card, not an organisation —
  // keep it visible under its own label rather than pretending it is a promotion.
  const resolved = resolvePromotion(ev.promotion);
  const label = resolved.slug === "combat" ? (ev.promotion?.trim() || "— unattributed —") : resolved.name;
  if (promotionFilter && !label.toLowerCase().includes(promotionFilter.toLowerCase())) continue;

  const g = groups.get(label) ?? {
    promotion: label,
    sport: new Set<string>(),
    total: 0,
    empty: 0,
    filled: 0,
    reasons: new Map<Reason, number>(),
    examples: [],
  };
  g.sport.add(ev.sport);
  g.total += 1;
  if (ev._count.fights > 0) {
    g.filled += 1;
  } else {
    g.empty += 1;
    const reason = diagnose(ev);
    g.reasons.set(reason, (g.reasons.get(reason) ?? 0) + 1);
    g.examples.push({ name: ev.name, date: ev.date, reason });
  }
  groups.set(label, g);
}

const rows = [...groups.values()].sort((a, b) => b.empty - a.empty || b.total - a.total);

const w = {
  promo: Math.max(9, ...rows.map((r) => r.promotion.length)) + 2,
  sport: Math.max(5, ...rows.map((r) => [...r.sport].join(",").length)) + 2,
};

console.log("\n── past events by promotion ────────────────────────────────────────");
console.log(
  "  " + "promotion".padEnd(w.promo) + "sport".padEnd(w.sport) +
    "events".padStart(8) + "filled".padStart(8) + "empty".padStart(7),
);
console.log("  " + "─".repeat(w.promo + w.sport + 23));
for (const r of rows) {
  console.log(
    `  ${r.promotion.padEnd(w.promo)}${[...r.sport].join(",").padEnd(w.sport)}` +
      `${String(r.total).padStart(8)}${String(r.filled).padStart(8)}${String(r.empty).padStart(7)}`,
  );
}
const totals = rows.reduce(
  (a, r) => ({ total: a.total + r.total, filled: a.filled + r.filled, empty: a.empty + r.empty }),
  { total: 0, filled: 0, empty: 0 },
);
console.log("  " + "─".repeat(w.promo + w.sport + 23));
console.log(
  `  ${"TOTAL".padEnd(w.promo)}${"".padEnd(w.sport)}` +
    `${String(totals.total).padStart(8)}${String(totals.filled).padStart(8)}${String(totals.empty).padStart(7)}`,
);

// ── the documented reason, per promotion ───────────────────────────────────
const withEmpty = rows.filter((r) => r.empty > 0);
if (!withEmpty.length) {
  console.log("\n  No past event is missing its card. Nothing to explain.");
} else {
  console.log("\n── why those cards are empty ───────────────────────────────────────");
  for (const r of withEmpty) {
    console.log(`\n  ${r.promotion}  (${r.empty} empty)`);
    for (const [reason, n] of [...r.reasons].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(4)}  ${reason}`);
    }
    if (showList) {
      for (const e of r.examples) {
        console.log(`          ${e.date.toISOString().slice(0, 10)}  ${e.name}   [${e.reason}]`);
      }
    }
  }
}

// ── what to DO about each reason ───────────────────────────────────────────
const allReasons = new Map<Reason, number>();
for (const r of rows) for (const [k, n] of r.reasons) allReasons.set(k, (allReasons.get(k) ?? 0) + n);

if (allReasons.size) {
  console.log("\n── what each reason means ──────────────────────────────────────────");
  const advice: Record<Reason, string> = {
    "synthetic container":
      "NOT FIXABLE, and not a failure. An internal daily container the odds pipeline\n" +
      "        invents; no upstream source indexes it. Upstream the BOUT is the unit — those\n" +
      "        bouts resolve individually via results:backfill. Building a promotion scraper\n" +
      "        for these would find nothing, because there is nothing to find.",
    "never attempted":
      "ACTIONABLE NOW: npm run results:backfill -- --historical\n" +
      "        The wikicard provider already covers the missing-card gap, promotion-agnostically.",
    "no source page found":
      "Source coverage. The search ladder returned nothing plausible. A promotion-specific\n" +
      "        scraper is the right answer HERE, if the promotion publishes cards in static HTML.",
    "page found, no card parsed":
      "PARSER gap: a page was read and this extractor found no table in it. Fixable by us.",
    "page found, not our bout":
      "ENTITY RESOLUTION gap: the card parsed but no bout matched ours. Add a FighterAlias,\n" +
      "        or widen the ladder in src/lib/entities/resolve.ts. Fixable by us.",
    "fetch error": "TRANSIENT or blocked. Re-run; if it persists the source is refusing us.",
    "attempted, other": "Unclassified reason string — inspect Event.resultAttemptReason.",
  };
  for (const [reason, n] of [...allReasons].sort((a, b) => b[1] - a[1])) {
    console.log(`\n  ${reason} — ${n} event(s)`);
    console.log(`        ${advice[reason]}`);
  }
}

await prisma.$disconnect();
