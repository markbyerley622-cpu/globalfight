/**
 * Single typed fixture layer for GlobalFight.
 *
 * ALL mock data lives here. Components never inline their own arrays — they
 * read through the accessors in `store.ts`. Swap this module for real service
 * calls and nothing in the UI changes.
 *
 * Athlete and promotion names below are invented for the skeleton; imagery is
 * intentionally left to placeholders.
 */
import type {
  Article,
  Athlete,
  DiscussionPost,
  DiscussionPrompt,
  DiscussionThread,
  Event,
  Fight,
  FightResult,
  PredictionMarket,
  Promotion,
  Sport,
  Venue,
} from "@/lib/domain/types";
import { clock } from "./clock";

// --- Sports -----------------------------------------------------------------

export const SPORTS: Sport[] = [
  { id: "sp-mma", slug: "mma", name: "MMA", family: "mixed", icon: "🥊", accentColor: "#ef4444" },
  { id: "sp-box", slug: "boxing", name: "Boxing", family: "striking", icon: "🥊", accentColor: "#f59e0b" },
  { id: "sp-mt", slug: "muay-thai", name: "Muay Thai", family: "striking", icon: "🦵", accentColor: "#8b5cf6" },
  { id: "sp-kick", slug: "kickboxing", name: "Kickboxing", family: "striking", icon: "🦶", accentColor: "#06b6d4" },
  { id: "sp-bkb", slug: "bare-knuckle", name: "Bare-knuckle", family: "striking", icon: "✊", accentColor: "#dc2626" },
  { id: "sp-bjj", slug: "bjj", name: "BJJ", family: "grappling", icon: "🥋", accentColor: "#3b82f6" },
  { id: "sp-wr", slug: "wrestling", name: "Wrestling", family: "grappling", icon: "🤼", accentColor: "#10b981" },
  { id: "sp-judo", slug: "judo", name: "Judo", family: "grappling", icon: "🥋", accentColor: "#ec4899" },
  { id: "sp-tkd", slug: "taekwondo", name: "Taekwondo", family: "striking", icon: "🦵", accentColor: "#eab308" },
  { id: "sp-sambo", slug: "sambo", name: "Sambo", family: "grappling", icon: "🤼", accentColor: "#f97316" },
];

// --- Promotions -------------------------------------------------------------

export const PROMOTIONS: Promotion[] = [
  { id: "pr-apex", slug: "apex-fc", sportId: "sp-mma", name: "Apex Fighting Championship", shortName: "Apex FC", country: "USA" },
  { id: "pr-vanguard", slug: "vanguard-mma", sportId: "sp-mma", name: "Vanguard MMA", shortName: "Vanguard", country: "UK" },
  { id: "pr-crown", slug: "crown-boxing", sportId: "sp-box", name: "Crown Boxing", shortName: "Crown", country: "UK" },
  { id: "pr-summit", slug: "summit-muaythai", sportId: "sp-mt", name: "Summit Muay Thai", shortName: "Summit", country: "Thailand" },
  { id: "pr-blitz", slug: "blitz-kickboxing", sportId: "sp-kick", name: "Blitz Kickboxing", shortName: "Blitz", country: "Netherlands" },
  { id: "pr-ironfist", slug: "ironfist-bkb", sportId: "sp-bkb", name: "Ironfist Bare Knuckle", shortName: "Ironfist", country: "USA" },
  { id: "pr-gauntlet", slug: "gauntlet-bjj", sportId: "sp-bjj", name: "Gauntlet Grappling", shortName: "Gauntlet", country: "Brazil" },
];

// --- Venues -----------------------------------------------------------------

export const VENUES: Venue[] = [
  { id: "vn-vegas", name: "Silver Dome Arena", city: "Las Vegas", country: "USA", timezone: "America/Los_Angeles" },
  { id: "vn-london", name: "Riverside Arena", city: "London", country: "UK", timezone: "Europe/London" },
  { id: "vn-bangkok", name: "Rajadamnern Hall", city: "Bangkok", country: "Thailand", timezone: "Asia/Bangkok" },
  { id: "vn-amsterdam", name: "Harbor Hall", city: "Amsterdam", country: "Netherlands", timezone: "Europe/Amsterdam" },
  { id: "vn-miami", name: "Bayfront Pavilion", city: "Miami", country: "USA", timezone: "America/New_York" },
  { id: "vn-saopaulo", name: "Ginásio Central", city: "São Paulo", country: "Brazil", timezone: "America/Sao_Paulo" },
];

// --- Athletes ---------------------------------------------------------------

function rec(wins: number, losses: number, draws = 0, notes?: string) {
  return { wins, losses, draws, notes };
}

export const ATHLETES: Athlete[] = [
  // MMA roster
  { id: "at-marchetti", slug: "diego-marchetti", name: "Diego Marchetti", nickname: "El Fuego", country: "Brazil", countryCode: "BR", record: rec(24, 3, 0, "14 KO") },
  { id: "at-abdulaev", slug: "ruslan-abdulaev", name: "Ruslan Abdulaev", nickname: "The Wolf", country: "Russia", countryCode: "RU", record: rec(22, 1, 0, "9 SUB") },
  { id: "at-osei", slug: "kwame-osei", name: "Kwame Osei", nickname: "Thunder", country: "Ghana", countryCode: "GH", record: rec(18, 4, 0, "12 KO") },
  { id: "at-voss", slug: "tyler-voss", name: "Tyler Voss", country: "USA", countryCode: "US", record: rec(15, 2, 0) },
  { id: "at-tanaka", slug: "hiroshi-tanaka", name: "Hiroshi Tanaka", nickname: "Silk", country: "Japan", countryCode: "JP", record: rec(19, 6, 1) },
  { id: "at-delgado", slug: "cain-delgado", name: "Cain Delgado", country: "Mexico", countryCode: "MX", record: rec(16, 3, 0, "10 KO") },
  { id: "at-novak", slug: "petr-novak", name: "Petr Novák", country: "Czechia", countryCode: "CZ", record: rec(13, 5, 0) },
  { id: "at-mbeki", slug: "sipho-mbeki", name: "Sipho Mbeki", nickname: "Vice", country: "South Africa", countryCode: "ZA", record: rec(11, 1, 0, "7 SUB") },
  { id: "at-ferreira", slug: "lucas-ferreira", name: "Lucas Ferreira", country: "Brazil", countryCode: "BR", record: rec(14, 4, 0) },
  { id: "at-kaminski", slug: "adam-kaminski", name: "Adam Kamiński", country: "Poland", countryCode: "PL", record: rec(12, 2, 0) },
  { id: "at-oconnor", slug: "sean-oconnor", name: "Sean O'Connor", nickname: "Irish", country: "Ireland", countryCode: "IE", record: rec(10, 0, 0, "6 KO") },
  { id: "at-park", slug: "min-jae-park", name: "Min-jae Park", country: "South Korea", countryCode: "KR", record: rec(13, 3, 1) },
  // Boxing
  { id: "at-boxer-a", slug: "andre-whitlock", name: "André Whitlock", country: "UK", countryCode: "GB", record: rec(21, 0, 0, "15 KO") },
  { id: "at-boxer-b", slug: "marcus-reyes", name: "Marcus Reyes", country: "USA", countryCode: "US", record: rec(19, 2, 1, "13 KO") },
  // Muay Thai
  { id: "at-mt-a", slug: "somchai-pinsinchai", name: "Somchai Pinsinchai", country: "Thailand", countryCode: "TH", record: rec(112, 18, 4) },
  { id: "at-mt-b", slug: "yannick-durand", name: "Yannick Durand", country: "France", countryCode: "FR", record: rec(48, 9, 1) },
  // Kickboxing
  { id: "at-kick-a", slug: "jeroen-bakker", name: "Jeroen Bakker", country: "Netherlands", countryCode: "NL", record: rec(61, 7, 0, "30 KO") },
  { id: "at-kick-b", slug: "omar-haddad", name: "Omar Haddad", country: "Morocco", countryCode: "MA", record: rec(44, 6, 2) },
  // Bare-knuckle
  { id: "at-bkb-a", slug: "billy-rourke", name: "Billy Rourke", country: "USA", countryCode: "US", record: rec(9, 2, 0, "8 KO") },
  { id: "at-bkb-b", slug: "dovydas-kazlauskas", name: "Dovydas Kazlauskas", country: "Lithuania", countryCode: "LT", record: rec(7, 1, 0) },
  // BJJ
  { id: "at-bjj-a", slug: "rafael-santos", name: "Rafael Santos", country: "Brazil", countryCode: "BR", record: rec(31, 6, 3) },
  { id: "at-bjj-b", slug: "gordon-hale", name: "Gordon Hale", country: "USA", countryCode: "US", record: rec(28, 4, 5) },
];

const athletesById = new Map(ATHLETES.map((a) => [a.id, a]));
export function athlete(id: string): Athlete {
  const a = athletesById.get(id);
  if (!a) throw new Error(`Unknown athlete: ${id}`);
  return a;
}

// --- Fights + results (defined before events so events can reference ids) ----

export const FIGHTS: Fight[] = [];
export const RESULTS: FightResult[] = [];

interface FightSeed {
  id: string;
  slug: string;
  eventId: string;
  boutOrder: number;
  segment: Fight["segment"];
  weightClass: string;
  scheduledRounds: number | null;
  titleFight?: boolean;
  status: Fight["status"];
  red: { athleteId: string; ranking?: number };
  blue: { athleteId: string; ranking?: number };
  result?: Omit<FightResult, "fightId">;
}

function addFight(seed: FightSeed): Fight {
  const fight: Fight = {
    id: seed.id,
    slug: seed.slug,
    eventId: seed.eventId,
    boutOrder: seed.boutOrder,
    segment: seed.segment,
    weightClass: seed.weightClass,
    scheduledRounds: seed.scheduledRounds,
    roundLengthSec: seed.scheduledRounds ? 300 : null,
    titleFight: seed.titleFight ?? false,
    status: seed.status,
    participants: [
      { athleteId: seed.red.athleteId, corner: "red", ranking: seed.red.ranking },
      { athleteId: seed.blue.athleteId, corner: "blue", ranking: seed.blue.ranking },
    ],
  };
  if (seed.result) {
    fight.resultId = seed.id;
    RESULTS.push({ fightId: seed.id, ...seed.result });
  }
  FIGHTS.push(fight);
  return fight;
}

// ============================================================================
// SHOWCASE EVENT A — Apex FC 48 (MMA, SCHEDULED, ~5 days out) — full card
// ============================================================================
[
  { id: "ft-a1", slug: "marchetti-vs-abdulaev", boutOrder: 6, segment: "main-event" as const, weightClass: "Light Heavyweight", titleFight: true, red: { athleteId: "at-marchetti", ranking: 0 }, blue: { athleteId: "at-abdulaev", ranking: 1 } },
  { id: "ft-a2", slug: "osei-vs-voss", boutOrder: 5, segment: "main-card" as const, weightClass: "Welterweight", red: { athleteId: "at-osei", ranking: 3 }, blue: { athleteId: "at-voss", ranking: 5 } },
  { id: "ft-a3", slug: "delgado-vs-novak", boutOrder: 4, segment: "main-card" as const, weightClass: "Lightweight", red: { athleteId: "at-delgado", ranking: 8 }, blue: { athleteId: "at-novak", ranking: 11 } },
  { id: "ft-a4", slug: "mbeki-vs-ferreira", boutOrder: 3, segment: "prelims" as const, weightClass: "Middleweight", red: { athleteId: "at-mbeki" }, blue: { athleteId: "at-ferreira" } },
  { id: "ft-a5", slug: "kaminski-vs-oconnor", boutOrder: 2, segment: "prelims" as const, weightClass: "Featherweight", red: { athleteId: "at-kaminski" }, blue: { athleteId: "at-oconnor" } },
  { id: "ft-a6", slug: "park-vs-tanaka", boutOrder: 1, segment: "early-prelims" as const, weightClass: "Bantamweight", red: { athleteId: "at-park" }, blue: { athleteId: "at-tanaka" } },
].forEach((f) => addFight({ ...f, eventId: "ev-apex-48", scheduledRounds: f.titleFight ? 5 : 3, status: "scheduled" }));

// ============================================================================
// SHOWCASE EVENT B — Apex FC 47 (MMA, LIVE) — mixed bout states
// ============================================================================
[
  { id: "ft-b1", slug: "voss-vs-delgado", boutOrder: 5, segment: "main-event" as const, weightClass: "Lightweight", status: "scheduled" as const, red: { athleteId: "at-voss", ranking: 5 }, blue: { athleteId: "at-delgado", ranking: 8 } },
  { id: "ft-b2", slug: "osei-vs-ferreira", boutOrder: 4, segment: "main-card" as const, weightClass: "Welterweight", status: "live" as const, red: { athleteId: "at-osei", ranking: 3 }, blue: { athleteId: "at-ferreira" } },
  { id: "ft-b3", slug: "novak-vs-kaminski", boutOrder: 3, segment: "main-card" as const, weightClass: "Lightweight", status: "completed" as const, red: { athleteId: "at-novak" }, blue: { athleteId: "at-kaminski" }, result: { method: "submission" as const, winnerCorner: "red" as const, endRound: 2, endTimeSec: 143, detail: "Rear-naked choke" } },
  { id: "ft-b4", slug: "oconnor-vs-mbeki", boutOrder: 2, segment: "prelims" as const, weightClass: "Middleweight", status: "completed" as const, red: { athleteId: "at-oconnor" }, blue: { athleteId: "at-mbeki" }, result: { method: "ko" as const, winnerCorner: "red" as const, endRound: 1, endTimeSec: 68, detail: "Left hook" } },
  { id: "ft-b5", slug: "park-vs-marchetti", boutOrder: 1, segment: "early-prelims" as const, weightClass: "Bantamweight", status: "completed" as const, red: { athleteId: "at-park" }, blue: { athleteId: "at-tanaka" }, result: { method: "decision-unanimous" as const, winnerCorner: "blue" as const, detail: "29-28, 29-28, 30-27" } },
].forEach((f) => addFight({ ...f, eventId: "ev-apex-47", scheduledRounds: 3 }));

// ============================================================================
// SHOWCASE EVENT C — Vanguard 12 (MMA, COMPLETED, 3 days ago) — full results
// ============================================================================
[
  { id: "ft-c1", slug: "abdulaev-vs-osei", boutOrder: 5, segment: "main-event" as const, weightClass: "Welterweight", titleFight: true, red: { athleteId: "at-abdulaev", ranking: 1 }, blue: { athleteId: "at-osei", ranking: 3 }, result: { method: "decision-split" as const, winnerCorner: "red" as const, detail: "48-47, 47-48, 48-47" } },
  { id: "ft-c2", slug: "ferreira-vs-voss", boutOrder: 4, segment: "main-card" as const, weightClass: "Lightweight", red: { athleteId: "at-ferreira" }, blue: { athleteId: "at-voss", ranking: 5 }, result: { method: "tko" as const, winnerCorner: "blue" as const, endRound: 3, endTimeSec: 212, detail: "Ground and pound" } },
  { id: "ft-c3", slug: "delgado-vs-park", boutOrder: 3, segment: "main-card" as const, weightClass: "Featherweight", red: { athleteId: "at-delgado" }, blue: { athleteId: "at-park" }, result: { method: "submission" as const, winnerCorner: "red" as const, endRound: 1, endTimeSec: 240, detail: "Guillotine choke" } },
  { id: "ft-c4", slug: "novak-vs-mbeki", boutOrder: 2, segment: "prelims" as const, weightClass: "Middleweight", red: { athleteId: "at-novak" }, blue: { athleteId: "at-mbeki" }, result: { method: "decision-unanimous" as const, winnerCorner: "blue" as const, detail: "30-27, 30-27, 29-28" } },
  { id: "ft-c5", slug: "oconnor-vs-kaminski", boutOrder: 1, segment: "prelims" as const, weightClass: "Featherweight", red: { athleteId: "at-oconnor" }, blue: { athleteId: "at-kaminski" }, result: { method: "draw" as const, winnerCorner: null, detail: "28-28, 28-28, 29-28" } },
].forEach((f) => addFight({ ...f, eventId: "ev-vanguard-12", scheduledRounds: f.titleFight ? 5 : 3, status: "completed" }));

// --- Lighter cards for discovery variety (other sports) ---------------------
addFight({ id: "ft-box1", slug: "whitlock-vs-reyes", eventId: "ev-crown-night", boutOrder: 3, segment: "main-event", weightClass: "Super Middleweight", scheduledRounds: 12, titleFight: true, status: "scheduled", red: { athleteId: "at-boxer-a", ranking: 0 }, blue: { athleteId: "at-boxer-b", ranking: 2 } });
addFight({ id: "ft-mt1", slug: "pinsinchai-vs-durand", eventId: "ev-summit-9", boutOrder: 3, segment: "main-event", weightClass: "Lightweight", scheduledRounds: 5, titleFight: true, status: "scheduled", red: { athleteId: "at-mt-a", ranking: 0 }, blue: { athleteId: "at-mt-b", ranking: 1 } });
addFight({ id: "ft-kick1", slug: "bakker-vs-haddad", eventId: "ev-blitz-22", boutOrder: 3, segment: "main-event", weightClass: "Heavyweight", scheduledRounds: 3, titleFight: true, status: "scheduled", red: { athleteId: "at-kick-a", ranking: 0 }, blue: { athleteId: "at-kick-b", ranking: 4 } });
addFight({ id: "ft-bkb1", slug: "rourke-vs-kazlauskas", eventId: "ev-ironfist-8", boutOrder: 3, segment: "main-event", weightClass: "Welterweight", scheduledRounds: 5, status: "scheduled", red: { athleteId: "at-bkb-a" }, blue: { athleteId: "at-bkb-b" } });
addFight({ id: "ft-bjj1", slug: "santos-vs-hale", eventId: "ev-gauntlet-open", boutOrder: 3, segment: "main-event", weightClass: "Absolute", scheduledRounds: null, status: "scheduled", red: { athleteId: "at-bjj-a" }, blue: { athleteId: "at-bjj-b" } });

// --- Events -----------------------------------------------------------------

export const EVENTS: Event[] = [
  {
    id: "ev-apex-48",
    slug: "apex-fc-48",
    sportId: "sp-mma",
    promotionId: "pr-apex",
    name: "Apex FC 48: Marchetti vs Abdulaev",
    status: "scheduled",
    startsAt: clock.daysFromNow(5),
    mainCardStartsAt: clock.daysFromNow(5),
    venueId: "vn-vegas",
    broadcasts: [
      { region: "US", channel: "Apex+ PPV", kind: "ppv" },
      { region: "UK", channel: "FightPass", kind: "streaming" },
    ],
    fightIds: ["ft-a1", "ft-a2", "ft-a3", "ft-a4", "ft-a5", "ft-a6"],
    headlineFightId: "ft-a1",
    description:
      "Apex FC returns to Las Vegas as light-heavyweight champion Diego Marchetti defends against surging challenger Ruslan Abdulaev in a five-round main event.",
  },
  {
    id: "ev-apex-47",
    slug: "apex-fc-47",
    sportId: "sp-mma",
    promotionId: "pr-apex",
    name: "Apex FC 47: Voss vs Delgado",
    status: "live",
    startsAt: clock.hoursAgo(2),
    mainCardStartsAt: clock.hoursAgo(1),
    venueId: "vn-miami",
    broadcasts: [{ region: "US", channel: "Apex+ PPV", kind: "ppv" }],
    fightIds: ["ft-b1", "ft-b2", "ft-b3", "ft-b4", "ft-b5"],
    headlineFightId: "ft-b1",
    description: "A stacked lightweight card live from Miami, headlined by Tyler Voss and Cain Delgado.",
  },
  {
    id: "ev-vanguard-12",
    slug: "vanguard-12",
    sportId: "sp-mma",
    promotionId: "pr-vanguard",
    name: "Vanguard 12: Abdulaev vs Osei",
    status: "completed",
    startsAt: clock.daysAgo(3),
    venueId: "vn-london",
    broadcasts: [{ region: "UK", channel: "Vanguard TV", kind: "tv" }],
    fightIds: ["ft-c1", "ft-c2", "ft-c3", "ft-c4", "ft-c5"],
    headlineFightId: "ft-c1",
    description: "Vanguard's London card delivered a split-decision thriller in the welterweight main event.",
  },
  {
    id: "ev-crown-night",
    slug: "crown-fight-night",
    sportId: "sp-box",
    promotionId: "pr-crown",
    name: "Crown Fight Night: Whitlock vs Reyes",
    status: "scheduled",
    startsAt: clock.hoursFromNow(20),
    venueId: "vn-london",
    broadcasts: [{ region: "UK", channel: "Crown Sports", kind: "streaming" }],
    fightIds: ["ft-box1"],
    headlineFightId: "ft-box1",
    description: "Undefeated super-middleweight champion André Whitlock puts his belt on the line in London.",
  },
  {
    id: "ev-summit-9",
    slug: "summit-9",
    sportId: "sp-mt",
    promotionId: "pr-summit",
    name: "Summit 9: Pinsinchai vs Durand",
    status: "scheduled",
    startsAt: clock.daysFromNow(4),
    venueId: "vn-bangkok",
    broadcasts: [{ region: "Global", channel: "Summit Stream", kind: "streaming" }],
    fightIds: ["ft-mt1"],
    headlineFightId: "ft-mt1",
    description: "A five-round lightweight title war at the legendary Rajadamnern Hall.",
  },
  {
    id: "ev-blitz-22",
    slug: "blitz-22",
    sportId: "sp-kick",
    promotionId: "pr-blitz",
    name: "Blitz 22: Bakker vs Haddad",
    status: "scheduled",
    startsAt: clock.daysFromNow(16),
    venueId: "vn-amsterdam",
    broadcasts: [{ region: "EU", channel: "Blitz TV", kind: "tv" }],
    fightIds: ["ft-kick1"],
    headlineFightId: "ft-kick1",
    description: "Heavyweight kickboxing's biggest punchers collide in Amsterdam.",
  },
  {
    id: "ev-ironfist-8",
    slug: "ironfist-8",
    sportId: "sp-bkb",
    promotionId: "pr-ironfist",
    name: "Ironfist 8: Rourke vs Kazlauskas",
    status: "announced",
    startsAt: clock.daysFromNow(22),
    venueId: "vn-miami",
    broadcasts: [{ region: "US", channel: "Ironfist PPV", kind: "ppv" }],
    fightIds: ["ft-bkb1"],
    headlineFightId: "ft-bkb1",
    description: "Bare-knuckle returns with a welterweight grudge match.",
  },
  {
    id: "ev-gauntlet-open",
    slug: "gauntlet-open",
    sportId: "sp-bjj",
    promotionId: "pr-gauntlet",
    name: "Gauntlet Open: Santos vs Hale",
    status: "announced",
    startsAt: clock.daysFromNow(30),
    venueId: "vn-saopaulo",
    broadcasts: [{ region: "Global", channel: "Gauntlet+", kind: "streaming" }],
    fightIds: ["ft-bjj1"],
    headlineFightId: "ft-bjj1",
    description: "Absolute-division submission-only superfight in São Paulo.",
  },
];

// --- Coverage articles (attached to events, some to specific fights) --------

export const ARTICLES: Article[] = [
  { id: "ar-1", slug: "apex-48-preview", eventId: "ev-apex-48", sportId: "sp-mma", promotionId: "pr-apex", type: "preview", title: "Apex FC 48 preview: everything you need to know", excerpt: "Marchetti's title reign faces its stiffest test yet. We break down the full card.", publishedAt: clock.daysAgo(2), author: "Jordan Ellis", source: "GlobalFight Desk", tags: ["preview", "light-heavyweight"], imageUrl: undefined },
  { id: "ar-2", slug: "marchetti-abdulaev-breakdown", eventId: "ev-apex-48", fightId: "ft-a1", sportId: "sp-mma", type: "fight-breakdown", title: "Styles make fights: Marchetti's power vs Abdulaev's grappling", excerpt: "A technical look at the main-event chess match.", publishedAt: clock.daysAgo(1), author: "Priya Nair", source: "GlobalFight Desk", tags: ["breakdown", "main-event"] },
  { id: "ar-3", slug: "apex-48-weigh-in", eventId: "ev-apex-48", sportId: "sp-mma", type: "weigh-in", title: "Weigh-in results: all fighters on point", excerpt: "Every athlete made weight ahead of Saturday's card.", publishedAt: clock.hoursAgo(30), author: "Staff", source: "GlobalFight Desk", tags: ["weigh-in"] },
  { id: "ar-4", slug: "apex-48-broadcast", eventId: "ev-apex-48", sportId: "sp-mma", type: "broadcast", title: "How to watch Apex FC 48", excerpt: "Start times and channels by region.", publishedAt: clock.hoursAgo(20), author: "Staff", source: "GlobalFight Desk", tags: ["broadcast"] },
  { id: "ar-5", slug: "apex-47-live", eventId: "ev-apex-47", sportId: "sp-mma", type: "announcement", title: "Apex FC 47 live: round-by-round updates", excerpt: "Follow every bout from Miami as it happens.", publishedAt: clock.hoursAgo(2), author: "Live Desk", source: "GlobalFight Desk", tags: ["live"] },
  { id: "ar-6", slug: "vanguard-12-report", eventId: "ev-vanguard-12", fightId: "ft-c1", sportId: "sp-mma", type: "post-event-report", title: "Abdulaev edges Osei in split-decision classic", excerpt: "The judges were split, but Abdulaev's takedowns proved decisive.", publishedAt: clock.daysAgo(3), author: "Jordan Ellis", source: "GlobalFight Desk", tags: ["result", "recap"] },
  { id: "ar-7", slug: "vanguard-12-injury", eventId: "ev-vanguard-12", sportId: "sp-mma", type: "injury-update", title: "Osei to undergo hand surgery after Vanguard 12", excerpt: "The challenger fought through a broken hand.", publishedAt: clock.daysAgo(2), author: "Priya Nair", source: "GlobalFight Desk", tags: ["injury"] },
  { id: "ar-8", slug: "crown-night-presser", eventId: "ev-crown-night", sportId: "sp-box", type: "press-conference", title: "Whitlock and Reyes trade words at final presser", excerpt: "Tempers flared ahead of tomorrow's title fight.", publishedAt: clock.hoursAgo(6), author: "Marcus Reed", source: "GlobalFight Desk", tags: ["press-conference"] },
];

// --- Prediction markets (one per bout that supports voting) -----------------

function market(id: string, fightId: string, eventId: string, redAthlete: string, blueAthlete: string, redVotes: number, blueVotes: number, status: PredictionMarket["status"], locksAt: string): PredictionMarket {
  return {
    id,
    fightId,
    eventId,
    locksAt,
    status,
    totalVotes: redVotes + blueVotes,
    options: [
      { corner: "red", athleteId: redAthlete, votes: redVotes },
      { corner: "blue", athleteId: blueAthlete, votes: blueVotes },
    ],
  };
}

export const MARKETS: PredictionMarket[] = [
  // Apex 48 (open)
  market("mk-a1", "ft-a1", "ev-apex-48", "at-marchetti", "at-abdulaev", 6120, 4880, "open", clock.daysFromNow(5)),
  market("mk-a2", "ft-a2", "ev-apex-48", "at-osei", "at-voss", 3400, 2100, "open", clock.daysFromNow(5)),
  market("mk-a3", "ft-a3", "ev-apex-48", "at-delgado", "at-novak", 2900, 2750, "open", clock.daysFromNow(5)),
  market("mk-a4", "ft-a4", "ev-apex-48", "at-mbeki", "at-ferreira", 1800, 1200, "open", clock.daysFromNow(5)),
  market("mk-a5", "ft-a5", "ev-apex-48", "at-kaminski", "at-oconnor", 900, 2600, "open", clock.daysFromNow(5)),
  market("mk-a6", "ft-a6", "ev-apex-48", "at-park", "at-tanaka", 1400, 1350, "open", clock.daysFromNow(5)),
  // Apex 47 (live: some locked/settled)
  market("mk-b1", "ft-b1", "ev-apex-47", "at-voss", "at-delgado", 5200, 4100, "open", clock.minutesFromNow(40)),
  market("mk-b2", "ft-b2", "ev-apex-47", "at-osei", "at-ferreira", 6100, 3000, "locked", clock.minutesAgo(5)),
  market("mk-b3", "ft-b3", "ev-apex-47", "at-novak", "at-kaminski", 4300, 4200, "settled", clock.minutesAgo(40)),
  market("mk-b4", "ft-b4", "ev-apex-47", "at-oconnor", "at-mbeki", 3900, 2100, "settled", clock.minutesAgo(70)),
  market("mk-b5", "ft-b5", "ev-apex-47", "at-park", "at-tanaka", 2600, 2500, "settled", clock.minutesAgo(100)),
  // Vanguard 12 (settled)
  market("mk-c1", "ft-c1", "ev-vanguard-12", "at-abdulaev", "at-osei", 5100, 4900, "settled", clock.daysAgo(3)),
  market("mk-c2", "ft-c2", "ev-vanguard-12", "at-ferreira", "at-voss", 2200, 6800, "settled", clock.daysAgo(3)),
  market("mk-c3", "ft-c3", "ev-vanguard-12", "at-delgado", "at-park", 4400, 3600, "settled", clock.daysAgo(3)),
  market("mk-c4", "ft-c4", "ev-vanguard-12", "at-novak", "at-mbeki", 3100, 3900, "settled", clock.daysAgo(3)),
  market("mk-c5", "ft-c5", "ev-vanguard-12", "at-oconnor", "at-kaminski", 3500, 3500, "settled", clock.daysAgo(3)),
];

// --- Discussion threads, posts, prompts -------------------------------------

export const THREADS: DiscussionThread[] = [
  { id: "th-a", eventId: "ev-apex-48", title: "Apex FC 48 — official event thread", postCount: 3 },
  { id: "th-b", eventId: "ev-apex-47", title: "Apex FC 47 — LIVE discussion", postCount: 2 },
  { id: "th-c", eventId: "ev-vanguard-12", title: "Vanguard 12 — post-event", postCount: 2 },
];

const author = (id: string, handle: string, reputation: number) => ({ id, handle, reputation });

export const POSTS: DiscussionPost[] = [
  { id: "po-1", threadId: "th-a", eventId: "ev-apex-48", author: author("u1", "octagon_oracle", 1840), body: "Abdulaev's takedown entries are elite. If he weathers the first round, I think he grinds out a decision.", createdAt: clock.hoursAgo(10), phase: "pre-event", replyCount: 4, reactionCount: 27, moderation: "visible" },
  { id: "po-2", threadId: "th-a", eventId: "ev-apex-48", fightId: "ft-a5", author: author("u2", "prelim_prophet", 640), body: "Everyone sleeping on O'Connor. 10-0 for a reason — he's my upset lock of the night.", createdAt: clock.hoursAgo(6), phase: "pre-event", replyCount: 2, reactionCount: 11, moderation: "visible" },
  { id: "po-3", threadId: "th-a", eventId: "ev-apex-48", author: author("u3", "casual_carl", 90), body: "First time watching Apex — where does the main card start in UK time?", createdAt: clock.hoursAgo(3), phase: "pre-event", replyCount: 1, reactionCount: 3, moderation: "visible" },
  { id: "po-4", threadId: "th-b", eventId: "ev-apex-47", fightId: "ft-b4", author: author("u4", "knockout_kim", 1220), body: "O'Connor with a ONE PUNCH KO! 68 seconds! Did anyone have that on their card?!", createdAt: clock.minutesAgo(50), phase: "live", replyCount: 6, reactionCount: 44, moderation: "visible" },
  { id: "po-5", threadId: "th-b", eventId: "ev-apex-47", author: author("u1", "octagon_oracle", 1840), body: "Ferreira's cardio looking shaky already. Osei should push the pace.", createdAt: clock.minutesAgo(8), phase: "live", replyCount: 0, reactionCount: 9, moderation: "visible" },
  { id: "po-6", threadId: "th-c", eventId: "ev-vanguard-12", fightId: "ft-c1", author: author("u5", "judge_judy", 2100), body: "Robbery. Osei landed the cleaner strikes for four rounds. Split decisions like this hurt the sport.", createdAt: clock.daysAgo(3), phase: "post-event", replyCount: 12, reactionCount: 88, moderation: "visible" },
  { id: "po-7", threadId: "th-c", eventId: "ev-vanguard-12", author: author("u6", "grapple_guru", 1560), body: "Disagree — Abdulaev's control time was decisive. Octagon control matters. Great fight either way.", createdAt: clock.daysAgo(3), phase: "post-event", replyCount: 8, reactionCount: 52, moderation: "visible" },
];

export const PROMPTS: DiscussionPrompt[] = [
  // Pre-event
  { id: "pr-1", eventId: "ev-apex-48", phase: "pre-event", text: "Who wins the main event and why?" },
  { id: "pr-2", eventId: "ev-apex-48", phase: "pre-event", text: "Which underdog has the best chance?" },
  { id: "pr-3", eventId: "ev-apex-48", phase: "pre-event", text: "Which bout will steal the show?" },
  { id: "pr-4", eventId: "ev-apex-48", phase: "pre-event", text: "Was the weigh-in significant?" },
  { id: "pr-5", eventId: "ev-apex-48", phase: "pre-event", text: "Which technical matchup matters most?" },
  // Live
  { id: "pr-6", eventId: "ev-apex-47", phase: "live", text: "Which bout will steal the show?" },
  { id: "pr-7", eventId: "ev-apex-47", phase: "live", text: "Who wins the main event and why?" },
  // Post-event
  { id: "pr-8", eventId: "ev-vanguard-12", phase: "post-event", text: "Was the result correct?" },
  { id: "pr-9", eventId: "ev-vanguard-12", phase: "post-event", text: "What should happen next?" },
];
