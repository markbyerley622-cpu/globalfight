// Structural integrity of the entity graph. WRITES NOTHING.
//
//   npm run audit:integrity                 # the report
//   npm run audit:integrity -- --list       # every offending row, not just totals
//   npm run audit:integrity -- --check=duplicate-events
//
// Sibling of cards:empty and coverage:audit, which answer "is the data THERE".
// This answers "is the data CONSISTENT" — the failures that do not show up as a
// missing card but as two of them, or as a fighter nobody can reach, or as a
// bout whose event says one date and whose row says another.
//
// Every check states what it found AND why that state is wrong, because a count
// with no explanation gets ignored. Checks are ordered by blast radius.
import { prisma } from "../src/lib/db.ts";
import { isPlaceholderName } from "../src/lib/entities/placeholder.ts";
import { winningCorner } from "../src/lib/event-format.ts";
import { hasHtmlEntity } from "../src/lib/text/entities.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string): string | undefined => {
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
};

const showList = flag("list");
const only = value("check");
const LIST_CAP = 25;

interface Finding {
  id: string;
  label: string;
  /** Why this state is wrong, in one sentence. */
  why: string;
  count: number;
  samples: string[];
}

const findings: Finding[] = [];
const wanted = (id: string) => !only || only === id;

function report(f: Finding) {
  findings.push(f);
  const head = f.count === 0 ? "  ok  " : "  !!  ";
  console.log(`${head}${f.label}: ${f.count}`);
  if (f.count > 0) {
    console.log(`        ${f.why}`);
    if (showList) for (const s of f.samples) console.log(`        · ${s}`);
    else if (f.samples.length) console.log(`        e.g. ${f.samples.slice(0, 3).join(" | ")}`);
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

// ── 1. Duplicate events ────────────────────────────────────────────────────
// Two rows for one card splits its bouts, picks and discussion in half. The
// usual cause is two providers naming the same card differently (see year-sync's
// naming problem), so identity is checked on (promotion, date) rather than name.
async function duplicateEvents() {
  if (!wanted("duplicate-events")) return;
  const rows = await prisma.event.findMany({
    where: { promotion: { not: null } },
    select: { id: true, name: true, slug: true, promotion: true, date: true, _count: { select: { fights: true } } },
    orderBy: { date: "asc" },
  });
  const byKey = new Map<string, typeof rows>();
  for (const e of rows) {
    const key = `${e.promotion!.toLowerCase()}|${iso(e.date)}`;
    const list = byKey.get(key) ?? [];
    list.push(e);
    byKey.set(key, list);
  }
  const dupes = [...byKey.entries()].filter(([, v]) => v.length > 1);
  report({
    id: "duplicate-events",
    label: "Same promotion, same DAY, more than one event row (COLLISIONS, not duplicates)",
    why:
      "A HEURISTIC, and mostly a false alarm — run `npm run audit:duplicates` for the classification. " +
      "Measured 2026-08-02: of 75 collisions only 2 were genuine duplicates. 49 were divisions of one " +
      "championship (every World Judo weight class shares a day) and 13 were numbered episodes of one " +
      "series (ONE's 'No Surrender' 1/2/3). Merging on this number alone would destroy real events.",
    count: dupes.length,
    samples: dupes.map(([k, v]) => `${k} → ${v.map((e) => `${e.slug}(${e._count.fights} bouts)`).join(" + ")}`),
  });
}

// ── 2. Orphan fighters ─────────────────────────────────────────────────────
// A fighter with no bouts is unreachable from any card, has no derivable record,
// and is exactly what a placeholder or a failed dedupe leaves behind.
async function orphanFighters() {
  if (!wanted("orphan-fighters")) return;
  const rows = await prisma.fighter.findMany({
    where: { fightsAsRed: { none: {} }, fightsAsBlue: { none: {} } },
    select: { slug: true, name: true, wins: true, losses: true, draws: true },
    take: 5000,
  });
  const placeholders = rows.filter((f) => isPlaceholderName(f.name));
  const recordless = rows.filter((f) => !isPlaceholderName(f.name) && !f.wins && !f.losses && !f.draws);

  report({
    id: "orphan-fighters",
    label: "Fighters with no bouts at all",
    why: "Unreachable from any card and with no derivable record — a failed dedupe or an import that never landed its bouts.",
    count: rows.length,
    samples: rows.slice(0, LIST_CAP).map((f) => `${f.slug} (${f.wins}-${f.losses}-${f.draws})`),
  });
  report({
    id: "orphan-fighters",
    label: "  ↳ of those, PLACEHOLDER rows that should not exist",
    why: "\"TBA\" was upserted as a person; it now 404s in the UI but the row is still in the table and still counted.",
    count: placeholders.length,
    samples: placeholders.slice(0, LIST_CAP).map((f) => f.slug),
  });
  report({
    id: "orphan-fighters",
    label: "  ↳ of those, no bouts AND no record",
    why: "Nothing on the profile can be populated — it renders as an empty page with a name on it.",
    count: recordless.length,
    samples: recordless.slice(0, LIST_CAP).map((f) => f.slug),
  });
}

// ── 3. Bout/event date disagreement ────────────────────────────────────────
async function boutDateDrift() {
  if (!wanted("bout-date-drift")) return;
  const rows = await prisma.fight.findMany({
    where: { eventId: { not: null } },
    select: { slug: true, date: true, event: { select: { slug: true, date: true } } },
    take: 20000,
  });
  const drifted = rows.filter((f) => f.event && Math.abs(+f.date - +f.event.date) > 36 * 3600 * 1000);
  report({
    id: "bout-date-drift",
    label: "Bouts dated more than 36h from their own event",
    why: "The bout was attached to the wrong card, or a provider wrote its own date over the event's — either way the schedule and the fighter's history disagree.",
    count: drifted.length,
    samples: drifted.slice(0, LIST_CAP).map((f) => `${f.slug} ${iso(f.date)} vs event ${f.event!.slug} ${iso(f.event!.date)}`),
  });
}

// ── 4. Decided bouts with no attributable winner ───────────────────────────
async function unattributedWins() {
  if (!wanted("unattributed-wins")) return;
  const rows = await prisma.fight.findMany({
    where: { result: "WIN" },
    select: { slug: true, winnerId: true, redId: true, blueId: true, red: { select: { slug: true } }, blue: { select: { slug: true } } },
    take: 20000,
  });
  const bad = rows.filter((f) => {
    const corner = winningCorner({
      result: "WIN",
      winnerId: f.winnerId ?? undefined,
      red: { id: f.redId, slug: f.red.slug } as never,
      blue: { id: f.blueId, slug: f.blue.slug } as never,
    });
    return corner === null;
  });
  report({
    id: "unattributed-wins",
    label: "Bouts marked WIN whose winner is neither corner",
    why: "A win nobody can be credited with: no record derives from it, settlement has nothing to grade, and every surface has to invent a rule for what to show.",
    count: bad.length,
    samples: bad.slice(0, LIST_CAP).map((f) => `${f.slug} winnerId=${f.winnerId ?? "null"}`),
  });
}

// ── 5. Placeholder bouts still holding a card slot ─────────────────────────
async function placeholderBouts() {
  if (!wanted("placeholder-bouts")) return;
  const rows = await prisma.fight.findMany({
    select: { slug: true, red: { select: { name: true } }, blue: { select: { name: true } } },
    take: 20000,
  });
  const bad = rows.filter((f) => isPlaceholderName(f.red.name) || isPlaceholderName(f.blue.name));
  report({
    id: "placeholder-bouts",
    label: "Bouts with an unannounced corner",
    why: "Not yet a matchup: it must not be indexed, given a discussion room, or offered as a pick. The UI now refuses these, but the rows still occupy the card.",
    count: bad.length,
    samples: bad.slice(0, LIST_CAP).map((f) => `${f.slug} (${f.red.name} vs ${f.blue.name})`),
  });
}

// ── 6. Past cards still scheduled ──────────────────────────────────────────
async function staleStatus() {
  if (!wanted("stale-status")) return;
  const cutoff = new Date(Date.now() - 3 * 24 * 3600 * 1000);
  const rows = await prisma.event.findMany({
    where: { date: { lt: cutoff }, status: { in: ["SCHEDULED", "ANNOUNCED", "LIVE"] } },
    select: { slug: true, date: true, status: true, _count: { select: { fights: true } } },
    orderBy: { date: "desc" },
    take: 5000,
  });
  report({
    id: "stale-status",
    label: "Events more than 3 days past that are still SCHEDULED/ANNOUNCED/LIVE",
    why: "Status is read by pick eligibility, the countdown and every badge — a card that ended last month still advertising itself as upcoming is the contradiction the audit opened with.",
    count: rows.length,
    samples: rows.slice(0, LIST_CAP).map((e) => `${e.slug} ${iso(e.date)} ${e.status} (${e._count.fights} bouts)`),
  });
}

// ── 7. Sport disagreement between a card and its corners ───────────────────
async function sportDrift() {
  if (!wanted("sport-drift")) return;
  const rows = await prisma.event.findMany({
    where: { fights: { some: {} } },
    select: { slug: true, sport: true, promotion: true, fights: { select: { red: { select: { sport: true } } }, take: 40 } },
    take: 5000,
  });
  const drifted = rows.filter((e) => {
    const sports = new Set(e.fights.map((f) => f.red.sport));
    return sports.size === 1 && !sports.has(e.sport);
  });
  report({
    id: "sport-drift",
    label: "Cards whose every fighter is filed under a different sport than the card",
    why:
      "EXPECTED on mixed cards, since Fight.ruleset became the authority. Event.sport is the CARD's " +
      "majority ruleset and Fighter.sport is a DISCIPLINE derived from bouts — a ONE card of Muay Thai " +
      "specialists is legitimately labelled MMA. Investigate only when the card is from a " +
      "single-ruleset promotion, where the two must agree.",
    count: drifted.length,
    samples: drifted.slice(0, LIST_CAP).map((e) => `${e.slug} card=${e.sport} fighters=${e.fights[0]?.red.sport}`),
  });
}

// ── 8. Image coverage ──────────────────────────────────────────────────────
async function imageCoverage() {
  if (!wanted("images")) return;
  const [total, withImage] = await Promise.all([
    prisma.fighter.count({ where: { OR: [{ fightsAsRed: { some: {} } }, { fightsAsBlue: { some: {} } }] } }),
    prisma.fighter.count({
      where: {
        OR: [{ fightsAsRed: { some: {} } }, { fightsAsBlue: { some: {} } }],
        AND: [{ OR: [{ imageUrl: { not: null } }, { thumbUrl: { not: null } }, { photoUrl: { not: null } }] }],
      },
    }),
  ]);
  const missing = total - withImage;
  report({
    id: "images",
    label: `Fighters who appear on a card but have no photo (${withImage}/${total} covered)`,
    why: "Every card they appear on renders a generated placeholder instead of a face — the single most visible quality gap on the events page.",
    count: missing,
    samples: [],
  });
}

// ── 8b. Raw HTML entities in stored text ───────────────────────────────────
// The corruption that produced eight duplicate ONE events: a provider-local
// `.replace(/&amp;/g, "&")` decoded one entity and left `&#038;` and `&#8217;`
// in the stored name, which then went through slugify as "038" and "8217" and
// could never match the correctly-named copy of the same card.
async function htmlEntities() {
  if (!wanted("entities")) return;
  const [events, fighters] = await Promise.all([
    prisma.event.findMany({ select: { slug: true, name: true } }),
    prisma.fighter.findMany({ select: { slug: true, name: true } }),
  ]);
  const badEvents = events.filter((e) => hasHtmlEntity(e.name));
  const badFighters = fighters.filter((f) => hasHtmlEntity(f.name));

  report({
    id: "entities",
    label: "Events whose stored name contains an HTML entity",
    why: "The name is wrong on screen AND unmatchable: slugify turns \"&#038;\" into \"038\", so the same card from another source becomes a second, empty event.",
    count: badEvents.length,
    samples: badEvents.slice(0, LIST_CAP).map((e) => `${e.slug} "${e.name}"`),
  });
  report({
    id: "entities",
    label: "Fighters whose stored name contains an HTML entity",
    why: "Same failure at the fighter level — an encoded name never dedupes against its decoded twin.",
    count: badFighters.length,
    samples: badFighters.slice(0, LIST_CAP).map((f) => `${f.slug} "${f.name}"`),
  });
}

// ── 9. The social graph ────────────────────────────────────────────────────
// Follows are only "working" if the whole chain holds: a user has a username
// (no handle, no profile URL, no follow target), the UserFollow row exists, and
// both ends still resolve. A dangling half is invisible in the UI — the count
// simply reads one lower than it should.
async function socialGraph() {
  if (!wanted("social")) return;
  const [users, withUsername, follows, mutualPairs] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { username: { not: null } } }),
    prisma.userFollow.count(),
    prisma.userFollow.count({
      where: { follower: { followers: { some: {} } } },
    }),
  ]);

  console.log(`  ..  Social graph: ${users} users, ${withUsername} with a handle, ${follows} follow edges`);

  const handleless = users - withUsername;
  report({
    id: "social",
    label: "Users with no username",
    why: "No handle means no /u/ profile, so they cannot be linked to, followed, or shown in a follower list — they are invisible to the social graph.",
    count: handleless,
    samples: handleless
      ? (await prisma.user.findMany({ where: { username: null }, select: { id: true, email: true }, take: LIST_CAP }))
          .map((u) => `${u.id} (${u.email ? u.email.split("@")[0] + "@…" : "no email"})`)
      : [],
  });

  // Not a fault — a health signal. A social product with zero edges has a
  // discovery problem, not a bug, and the two need different responses.
  if (follows === 0) {
    console.log("        NOTE: zero follow edges. The follow path is wired but nobody has used it.");
  } else {
    console.log(`        ${mutualPairs} of those edges are from someone who is themselves followed.`);
  }
}

async function main() {
  console.log("\n  Entity-graph integrity — reads only, writes nothing\n");
  await duplicateEvents();
  await orphanFighters();
  await boutDateDrift();
  await unattributedWins();
  await placeholderBouts();
  await staleStatus();
  await sportDrift();
  await imageCoverage();
  await htmlEntities();
  await socialGraph();

  const broken = findings.filter((f) => f.count > 0).length;
  console.log(`\n  ${findings.length} checks, ${broken} with findings.`);
  if (!showList && broken) console.log("  Re-run with --list for the full rows.\n");
  await prisma.$disconnect();
}

await main();
