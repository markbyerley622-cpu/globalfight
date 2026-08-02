// Fighter disciplines: what the label SAYS vs what the bouts SHOW.
//
//   npm run audit:disciplines                  # statistics
//   npm run audit:disciplines -- --list        # every drifted fighter
//   npm run audit:disciplines -- --class=contradicted
//   npm run audit:disciplines -- --apply       # WRITE the repairs
//
// Phase 1 is read-only by design: classify first, and only then repair the class
// that is provably safe. Muay Thai holds 95 events and 852 bouts while its
// fighter directory shows TEN, so the fix is worth getting right rather than
// fast — a wrong reclassification moves a fighter out of the directory they
// belong in, which is the same bug pointed the other way.
import { prisma } from "../src/lib/db.ts";
import { resolveDisciplines, classifyDrift, type DriftKind } from "../src/lib/fighters/disciplines.ts";
import { rulesetToSport } from "../src/lib/scraper/ruleset.ts";
import type { Sport } from "../src/lib/types.ts";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const showList = argv.includes("--list");
const only = argv.find((a) => a.startsWith("--class="))?.slice("--class=".length) as DriftKind | undefined;

const LABEL: Record<DriftKind, string> = {
  agrees: "Label matches the primary discipline",
  secondary: "Label is a REAL discipline, just not the main one",
  contradicted: "Label names a sport they have NEVER competed in",
  conflicting: "Multiple disciplines, label names none of them",
  unverifiable: "No bouts — the label cannot be checked either way",
};

/** Classes eligible for repair — narrowed further by isSafeRepair below. */
const REPAIRABLE: DriftKind[] = ["contradicted", "conflicting"];

// ════════════════════════════════════════════════════════════════════════════
//  THE GUARD. Event.sport is the CARD's majority ruleset, not the bout's.
//
//  The first run of this audit proposed, at confidence 1.00:
//      superlek-kiatmoo9   MUAY_THAI -> MMA
//      mikey-musumeci      BJJ       -> MMA
//      tye-ruotolo         BJJ       -> MMA
//      jonathan-haggerty   KICKBOXING-> MMA
//      mike-perry          BARE_KNUCKLE -> BOXING
//
//  Every one of those is wrong. They are specialists whose bouts sit on MIXED
//  cards: a ONE numbered event runs MMA, Muay Thai and grappling on one night,
//  and lib/scraper/ruleset classifies the CARD by what most of it is. So the
//  event says MMA and the individual bout does not.
//
//  The per-bout ruleset is the correct signal, Wikipedia states it inside the
//  weight class, and the wikicard mapper PARSES IT AND THROWS IT AWAY — there is
//  no Fight.ruleset column. Until there is, event sport can only be trusted in
//  one direction.
//
//  So: a SPECIALIST label is never overwritten by a card-majority sport. MMA and
//  BOXING are the labels providers fall back to; the specialist disciplines are
//  only ever set deliberately, and carry information the card does not.
// ════════════════════════════════════════════════════════════════════════════

/** Labels a provider assigns by default when it does not know better. */
const WEAK_LABELS = new Set<Sport>(["MMA", "BOXING"]);

/** True when the repair is supported by evidence the card cannot fake. */
function isSafeRepair(from: Sport, to: Sport | null): boolean {
  if (!to || to === from) return false;
  // Promoting a weak default to a specialist discipline: safe. A card whose
  // every bout is Muay Thai is Muay Thai, and MMA was never asserted, only
  // defaulted.
  if (WEAK_LABELS.has(from) && !WEAK_LABELS.has(to)) return true;
  // Demoting a specialist to a card-majority sport: REFUSED. This is the
  // Superlek case.
  if (!WEAK_LABELS.has(from) && WEAK_LABELS.has(to)) return false;
  // Specialist -> specialist, or weak -> weak. Neither is a card-majority
  // artefact, so the bout evidence stands.
  return true;
}

async function main() {
  console.log(`\n  Discipline audit — ${APPLY ? "APPLYING repairs" : "READ ONLY"}\n`);

  // Fight.ruleset, NOT Event.sport. The event's sport is the card's majority
  // ruleset and is false for most bouts on a mixed card — reading it here is
  // what proposed reclassifying Superlek from Muay Thai to MMA.
  const fighters = await prisma.fighter.findMany({
    select: {
      id: true, slug: true, name: true, sport: true,
      fightsAsRed: { select: { result: true, ruleset: true } },
      fightsAsBlue: { select: { result: true, ruleset: true } },
    },
  });

  type Row = { slug: string; from: Sport; to: Sport | null; sports: Sport[]; conf: number };
  const byDrift = new Map<DriftKind, Row[]>();
  const sportGain = new Map<string, number>();
  /** Repairs the evidence supports AND the card-majority guard permits. */
  const safe: Row[] = [];
  /** Repairs refused because the source event's sport is a card majority. */
  const refused: Row[] = [];

  for (const f of fighters) {
    const bouts = [...f.fightsAsRed, ...f.fightsAsBlue].map((b) => ({
      // UNKNOWN contributes nothing rather than falling back to the card.
      sport: b.ruleset === "UNKNOWN" ? null : rulesetToSport(b.ruleset),
      settled: b.result !== "SCHEDULED",
    }));

    const d = resolveDisciplines({ importedSport: f.sport as Sport, bouts });
    const drift = classifyDrift(f.sport as Sport, d);

    const row = { slug: f.slug, from: f.sport as Sport, to: d.primarySport, sports: d.sports, conf: d.confidence };
    byDrift.set(drift, [...(byDrift.get(drift) ?? []), row]);

    if (REPAIRABLE.includes(drift)) {
      if (isSafeRepair(f.sport as Sport, d.primarySport)) {
        safe.push(row);
        sportGain.set(d.primarySport!, (sportGain.get(d.primarySport!) ?? 0) + 1);
      } else if (d.primarySport && d.primarySport !== f.sport) {
        refused.push(row);
      }
    }
  }

  console.log(`  ${fighters.length} fighters audited\n`);
  const order: DriftKind[] = ["agrees", "secondary", "contradicted", "conflicting", "unverifiable"];
  for (const k of order) {
    const list = byDrift.get(k) ?? [];
    if (only && only !== k) continue;
    const tag = REPAIRABLE.includes(k) ? "REPAIR" : "KEEP  ";
    console.log(`  ${tag} ${list.length.toString().padStart(5)}  ${LABEL[k]}`);
    if (list.length && (showList || only)) {
      for (const r of list.slice(0, 60)) {
        console.log(`            ${r.slug}: ${r.from} -> ${r.to} [${r.sports.join(", ")}] conf=${r.conf.toFixed(2)}`);
      }
      if (list.length > 60) console.log(`            … and ${list.length - 60} more`);
    }
  }

  console.log(`\n  ${safe.length} safe repair(s); ${refused.length} REFUSED by the card-majority guard.`);
  if (refused.length) {
    console.log("  Refused (a specialist label must not be overwritten by a card's majority sport):");
    for (const r of refused.slice(0, 12)) console.log(`      ${r.slug}: ${r.from} -> ${r.to}  KEEPING ${r.from}`);
    if (refused.length > 12) console.log(`      … and ${refused.length - 12} more`);
  }
  if (sportGain.size) {
    console.log("  Directory gain:");
    for (const [k, v] of [...sportGain.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`      +${v}  ${k}`);
    }
  }

  if (!APPLY) {
    console.log("\n  READ ONLY — nothing written. Re-run with --apply.\n");
    return;
  }

  // Only the PRIMARY column is written. The multi-discipline set needs a schema
  // change and is a separate step — this repairs the wrong single value first.
  let written = 0;
  for (const r of safe) {
    await prisma.fighter.update({ where: { slug: r.slug }, data: { sport: r.to! } });
    written += 1;
  }
  console.log(`\n  ${written} fighter(s) reclassified.\n`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
