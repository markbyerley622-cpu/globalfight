// ════════════════════════════════════════════════════════════════════════
//  ESPN scoreboard → canonical NormalizedEvent. PURE — no network, no prisma.
// ════════════════════════════════════════════════════════════════════════

import type { NormalizedEvent, NormalizedFightStub, SourceMeta } from "@/services/providers/types";
import type { EventStatus, FightResult } from "@/lib/types";
import type { EspnCompetition, EspnCompetitor, EspnEvent } from "./types";
import type { EspnLeague } from "./leagues";

export const ESPN_SOURCE = "espn";
/** A major broadcaster's own live scoreboard — above a community-edited article. */
export const ESPN_CONFIDENCE = 0.9;

const meta = (externalId: string, lastUpdated: string): SourceMeta => ({
  source: ESPN_SOURCE,
  confidence: ESPN_CONFIDENCE,
  lastUpdated,
  externalId,
});

/**
 * "W Bantamweight" → "Women's Bantamweight".
 *
 * ESPN's own abbreviation. Left alone it never matches a WeightClass row, and
 * the division reads as a typo on the bout.
 */
export function normalizeWeightClass(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  return t.replace(/^W\s+/i, "Women's ").replace(/\s+/g, " ");
}

const isFinal = (name: string | undefined): boolean => name === "STATUS_FINAL";

/**
 * The fighter's STABLE ESPN id, which is what makes a fighter resolve to one row
 * instead of one per appearance.
 *
 * In team sports a competitor is the team and the athlete is nested inside it. In
 * MMA the competitor IS the athlete (`type: "athlete"`,
 * `uid: "s:3301~a:3093653"`), and the id sits on the COMPETITOR — `athlete` often
 * carries only names and links, with no id at all. Reading `athlete.id` first
 * looks more correct and yields nothing on a real card: every bout on UFC 297
 * came back with no external id and therefore no winner, so a fully-decided card
 * mapped to twelve pending bouts.
 */
function athleteId(c: EspnCompetitor): string | undefined {
  const id = c.athlete?.id ?? c.id;
  return id ? `espn:${id}` : undefined;
}

/** ESPN event status → ours. */
function toEventStatus(statusName: string | undefined, date: Date, now: Date): EventStatus {
  if (statusName === "STATUS_FINAL") return "COMPLETED";
  if (statusName === "STATUS_IN_PROGRESS") return "LIVE";
  if (statusName === "STATUS_CANCELED") return "CANCELLED";
  if (statusName === "STATUS_POSTPONED") return "POSTPONED";
  return date < now ? "COMPLETED" : "SCHEDULED";
}

/** One ESPN competition → a fight stub, or null when it is not a usable bout. */
export function toFightStub(c: EspnCompetition): NormalizedFightStub | null {
  const corners = c.competitors ?? [];
  if (corners.length !== 2) return null;

  const [a, b] = corners;
  const redName = (a.athlete?.displayName ?? a.athlete?.fullName ?? "").trim();
  const blueName = (b.athlete?.displayName ?? b.athlete?.fullName ?? "").trim();
  if (!redName || !blueName || redName === blueName) return null;

  const final = isFinal(c.status?.type?.name);
  const winner = final ? corners.find((x) => x.winner) : undefined;

  const redExternalId = athleteId(a);
  const blueExternalId = athleteId(b);
  const winnerExternalId = winner ? athleteId(winner) : undefined;

  // A final bout where ESPN marks NO winner is a draw or a no-contest, and the
  // scoreboard does not say which. Recording it as a WIN with no winner would be
  // worse than leaving it: the card would claim a decided bout nobody won.
  const result: FightResult = final && winnerExternalId ? "WIN" : "SCHEDULED";

  return {
    redName,
    blueName,
    redExternalId,
    blueExternalId,
    weightClass: normalizeWeightClass(c.type?.abbreviation ?? c.type?.text),
    scheduledRounds: c.format?.regulation?.periods,
    result,
    winnerExternalId: result === "WIN" ? winnerExternalId : undefined,
    // ROUND: the period the bout was in when it ended. True for a finish and for
    // a decision alike.
    roundEnded: final && c.status?.period ? c.status.period : undefined,
    // METHOD AND TIME ARE DELIBERATELY ABSENT.
    //
    // The scoreboard payload carries neither. `notes` is empty on every card
    // sampled, and `displayClock` is a clock reading whose direction (elapsed vs
    // remaining) this endpoint never states — writing it into `timeEnded`, which
    // means elapsed, would be a coin flip presented as a fact. Both are available
    // from ESPN's per-fight summary endpoint if they turn out to be worth an
    // extra request per bout.
  };
}

export function toNormalizedEvent(
  ev: EspnEvent,
  league: EspnLeague,
  now: Date = new Date(),
): NormalizedEvent | null {
  if (!ev.id || !ev.date) return null;
  const date = new Date(ev.date);
  if (Number.isNaN(+date)) return null;

  const name = (ev.name ?? ev.shortName ?? "").trim();
  if (!name) return null;

  const bouts = ev.competitions ?? [];
  // ESPN lists a card prelims-first, so the MAIN EVENT IS LAST. Reversed here
  // because persist.ts assigns orderOnCard from the array index and treats index
  // 0 as the top of the card — unreversed, every card would be upside down.
  const fights = [...bouts]
    .reverse()
    .map(toFightStub)
    .filter((f): f is NormalizedFightStub => f !== null);

  if (fights.length) fights[0].mainEvent = true;

  // The venue hangs off the bouts, not the event.
  const venue = bouts.find((c) => c.venue?.fullName)?.venue;
  const externalId = `espn:${league.slug}:${ev.id}`;

  return {
    externalId,
    name,
    sport: league.sport,
    promotion: league.promotion,
    venue: venue?.fullName,
    city: venue?.address?.city,
    country: venue?.address?.country,
    date: date.toISOString(),
    status: toEventStatus(ev.status?.type?.name, date, now),
    fights,
    _meta: meta(externalId, now.toISOString()),
  };
}
