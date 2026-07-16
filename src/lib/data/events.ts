import type { FightEvent, Fight, FightPrediction } from "@/lib/types";
import { FIGHTERS_BY_SLUG } from "./fighters";

function fighter(slug: string) {
  const x = FIGHTERS_BY_SLUG.get(slug);
  if (!x) throw new Error(`Unknown fighter ${slug}`);
  return x;
}

let fid = 0;
function fight(
  red: string, blue: string,
  opts: Partial<Fight> & { prediction?: FightPrediction },
): Fight {
  fid += 1;
  return {
    id: `fight-${fid}`,
    slug: `${red}-vs-${blue}`,
    red: fighter(red),
    blue: fighter(blue),
    scheduledRounds: 12,
    titleFight: false,
    mainEvent: false,
    coMain: false,
    result: "SCHEDULED",
    date: opts.date ?? "2026-06-14T22:00:00Z",
    ...opts,
  };
}

export const UPCOMING_EVENTS: FightEvent[] = [
  {
    id: "evt-1",
    slug: "usyk-vs-joshua-3",
    name: "Usyk vs Joshua III",
    sport: "BOXING",
    promotion: "Matchroom Boxing",
    venue: "Wembley Stadium",
    city: "London",
    country: "United Kingdom",
    countryCode: "GB",
    broadcaster: "DAZN PPV",
    date: "2026-06-14T21:00:00Z",
    status: "SCHEDULED",
    fights: [
      fight("oleksandr-usyk", "anthony-joshua", {
        date: "2026-06-14T22:30:00Z",
        weightClass: "Heavyweight", titleFight: true, mainEvent: true, scheduledRounds: 12,
        prediction: {
          redProbability: 0.68, blueProbability: 0.32,
          methodPrediction: "UD", roundPrediction: 12,
          communityRed: 0.71, expertRed: 0.66, confidence: 0.74,
          rationale: "Usyk's footwork and ring generalship have twice solved Joshua. Expect another technical masterclass, though AJ's power keeps it competitive early.",
        },
      }),
      fight("jai-opetaia", "david-benavidez", {
        date: "2026-06-14T21:30:00Z",
        weightClass: "Cruiserweight", coMain: true,
        prediction: { redProbability: 0.55, blueProbability: 0.45, methodPrediction: "UD", communityRed: 0.52, expertRed: 0.57 },
      }),
    ],
  },
  {
    id: "evt-2",
    slug: "inoue-vs-nakatani",
    name: "Inoue vs Nakatani — Japan Superfight",
    sport: "BOXING",
    promotion: "Teiken / Ohashi",
    venue: "Tokyo Dome",
    city: "Tokyo",
    country: "Japan",
    countryCode: "JP",
    broadcaster: "ESPN+ / Lemino",
    date: "2026-07-19T10:00:00Z",
    status: "SCHEDULED",
    fights: [
      fight("naoya-inoue", "junto-nakatani", {
        date: "2026-07-19T11:00:00Z",
        weightClass: "Super Bantamweight", titleFight: true, mainEvent: true,
        prediction: {
          redProbability: 0.61, blueProbability: 0.39,
          methodPrediction: "KO", roundPrediction: 9,
          communityRed: 0.58, expertRed: 0.63, confidence: 0.66,
          rationale: "The biggest all-Japanese fight ever made. Inoue's power and experience edge a rangy, dangerous Nakatani.",
        },
      }),
    ],
  },
  {
    id: "evt-3",
    slug: "davis-vs-stevenson",
    name: "Davis vs Stevenson",
    sport: "BOXING",
    promotion: "Premier Boxing Champions",
    venue: "T-Mobile Arena",
    city: "Las Vegas",
    country: "United States",
    countryCode: "US",
    broadcaster: "Prime Video PPV",
    date: "2026-08-23T03:00:00Z",
    status: "SCHEDULED",
    fights: [
      fight("gervonta-davis", "shakur-stevenson", {
        date: "2026-08-23T04:00:00Z",
        weightClass: "Lightweight", titleFight: true, mainEvent: true,
        prediction: {
          redProbability: 0.52, blueProbability: 0.48,
          methodPrediction: "SD", communityRed: 0.49, expertRed: 0.5, confidence: 0.55,
          rationale: "Power versus precision. Tank's one-shot threat against Shakur's defensive genius makes this a pick'em.",
        },
      }),
    ],
  },
  {
    id: "evt-4",
    slug: "benavidez-vs-bivol",
    name: "Benavidez vs Bivol",
    sport: "BOXING",
    promotion: "Matchroom / Riyadh Season",
    venue: "Kingdom Arena",
    city: "Riyadh",
    country: "Saudi Arabia",
    countryCode: "SA",
    broadcaster: "DAZN PPV",
    date: "2026-09-13T19:00:00Z",
    status: "ANNOUNCED",
    fights: [
      fight("david-benavidez", "dmitry-bivol", {
        date: "2026-09-13T20:30:00Z",
        weightClass: "Light Heavyweight", titleFight: true, mainEvent: true,
        prediction: { redProbability: 0.47, blueProbability: 0.53, methodPrediction: "UD", communityRed: 0.51, expertRed: 0.45 },
      }),
    ],
  },
];

export const RESULTS: FightEvent[] = [
  {
    id: "evt-r1",
    slug: "crawford-vs-canelo",
    name: "Crawford vs Canelo — Undisputed",
    sport: "BOXING",
    promotion: "Riyadh Season",
    venue: "Allegiant Stadium",
    city: "Las Vegas",
    country: "United States",
    countryCode: "US",
    broadcaster: "Netflix",
    date: "2026-05-02T03:00:00Z",
    status: "COMPLETED",
    fights: [
      fight("terence-crawford", "canelo-alvarez", {
        date: "2026-05-02T04:30:00Z",
        weightClass: "Super Middleweight", titleFight: true, mainEvent: true,
        result: "WIN", winnerId: "terence-crawford", method: "UD", roundEnded: 12,
      }),
    ],
  },
  {
    id: "evt-r2",
    slug: "beterbiev-vs-bivol-3",
    name: "Beterbiev vs Bivol III",
    sport: "BOXING",
    promotion: "Riyadh Season",
    venue: "Kingdom Arena",
    city: "Riyadh",
    country: "Saudi Arabia",
    countryCode: "SA",
    broadcaster: "DAZN",
    date: "2026-04-05T19:00:00Z",
    status: "COMPLETED",
    fights: [
      fight("dmitry-bivol", "artur-beterbiev", {
        date: "2026-04-05T20:30:00Z",
        weightClass: "Light Heavyweight", titleFight: true, mainEvent: true,
        result: "WIN", winnerId: "dmitry-bivol", method: "MD", roundEnded: 12,
      }),
    ],
  },
];

export const ALL_FIGHTS: Fight[] = [
  ...UPCOMING_EVENTS.flatMap((e) => e.fights),
  ...RESULTS.flatMap((e) => e.fights),
];
