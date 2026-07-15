import type { ResultMethod, SportSlug } from "./types";

/**
 * Per-sport terminology and rules.
 *
 * Combat sports do not share vocabulary: MMA has "fighters" contesting a
 * "bout" over "rounds"; Judo has "athletes" in a "match" scored by "ippon".
 * Rather than hardcoding MMA language into shared components, every component
 * reads its labels from the sport's rule set. Adding a sport is a data change.
 */
export interface SportRules {
  /** Singular noun for a competitor, e.g. "Fighter", "Athlete", "Grappler". */
  competitorNoun: string;
  competitorNounPlural: string;
  /** Singular noun for a contest, e.g. "Bout", "Match", "Fight". */
  contestNoun: string;
  contestNounPlural: string;
  /** Label for the repeated time unit, e.g. "Round", "Period", null if none. */
  periodNoun: string | null;
  /** Whether contests are timed into fixed rounds/periods. */
  timed: boolean;
  /** Whether the sport commonly fields team competitions. */
  teamEvents: boolean;
  /** Corners are contextual; some grappling sports use white/blue instead. */
  cornerLabels: { red: string; blue: string };
  /** Result methods this sport actually produces (drives result formatting). */
  resultMethods: ResultMethod[];
  /** How the sport describes scoring when it goes the distance. */
  scoringLabel: string;
}

const MMA_RESULTS: ResultMethod[] = [
  "ko",
  "tko",
  "submission",
  "decision-unanimous",
  "decision-split",
  "decision-majority",
  "draw",
  "disqualification",
  "no-contest",
];

export const SPORT_RULES: Record<SportSlug, SportRules> = {
  mma: {
    competitorNoun: "Fighter",
    competitorNounPlural: "Fighters",
    contestNoun: "Bout",
    contestNounPlural: "Bouts",
    periodNoun: "Round",
    timed: true,
    teamEvents: false,
    cornerLabels: { red: "Red", blue: "Blue" },
    resultMethods: MMA_RESULTS,
    scoringLabel: "Judges' decision",
  },
  boxing: {
    competitorNoun: "Boxer",
    competitorNounPlural: "Boxers",
    contestNoun: "Fight",
    contestNounPlural: "Fights",
    periodNoun: "Round",
    timed: true,
    teamEvents: false,
    cornerLabels: { red: "Red", blue: "Blue" },
    resultMethods: [
      "ko",
      "tko",
      "decision-unanimous",
      "decision-split",
      "decision-majority",
      "draw",
      "disqualification",
    ],
    scoringLabel: "Judges' scorecards",
  },
  "muay-thai": {
    competitorNoun: "Fighter",
    competitorNounPlural: "Fighters",
    contestNoun: "Bout",
    contestNounPlural: "Bouts",
    periodNoun: "Round",
    timed: true,
    teamEvents: false,
    cornerLabels: { red: "Red", blue: "Blue" },
    resultMethods: [
      "ko",
      "tko",
      "decision-unanimous",
      "decision-split",
      "draw",
      "disqualification",
    ],
    scoringLabel: "Judges' decision",
  },
  kickboxing: {
    competitorNoun: "Fighter",
    competitorNounPlural: "Fighters",
    contestNoun: "Bout",
    contestNounPlural: "Bouts",
    periodNoun: "Round",
    timed: true,
    teamEvents: false,
    cornerLabels: { red: "Red", blue: "Blue" },
    resultMethods: [
      "ko",
      "tko",
      "decision-unanimous",
      "decision-split",
      "draw",
      "disqualification",
    ],
    scoringLabel: "Judges' decision",
  },
  "bare-knuckle": {
    competitorNoun: "Fighter",
    competitorNounPlural: "Fighters",
    contestNoun: "Fight",
    contestNounPlural: "Fights",
    periodNoun: "Round",
    timed: true,
    teamEvents: false,
    cornerLabels: { red: "Red", blue: "Blue" },
    resultMethods: [
      "ko",
      "tko",
      "decision-unanimous",
      "decision-split",
      "draw",
      "disqualification",
    ],
    scoringLabel: "Judges' decision",
  },
  bjj: {
    competitorNoun: "Grappler",
    competitorNounPlural: "Grapplers",
    contestNoun: "Match",
    contestNounPlural: "Matches",
    periodNoun: null,
    timed: true,
    teamEvents: false,
    cornerLabels: { red: "Red", blue: "Blue" },
    resultMethods: ["submission", "points", "decision-unanimous", "draw", "disqualification"],
    scoringLabel: "Points / advantages",
  },
  wrestling: {
    competitorNoun: "Wrestler",
    competitorNounPlural: "Wrestlers",
    contestNoun: "Match",
    contestNounPlural: "Matches",
    periodNoun: "Period",
    timed: true,
    teamEvents: true,
    cornerLabels: { red: "Red", blue: "Blue" },
    resultMethods: ["pin", "technical-superiority", "points", "decision-unanimous", "disqualification"],
    scoringLabel: "Points",
  },
  judo: {
    competitorNoun: "Judoka",
    competitorNounPlural: "Judoka",
    contestNoun: "Match",
    contestNounPlural: "Matches",
    periodNoun: null,
    timed: true,
    teamEvents: true,
    cornerLabels: { red: "White", blue: "Blue" },
    resultMethods: ["ippon", "points", "decision-unanimous", "disqualification"],
    scoringLabel: "Ippon / waza-ari",
  },
  taekwondo: {
    competitorNoun: "Athlete",
    competitorNounPlural: "Athletes",
    contestNoun: "Match",
    contestNounPlural: "Matches",
    periodNoun: "Round",
    timed: true,
    teamEvents: true,
    cornerLabels: { red: "Red (Hong)", blue: "Blue (Chung)" },
    resultMethods: ["ko", "points", "technical-superiority", "decision-unanimous", "disqualification"],
    scoringLabel: "Points",
  },
  sambo: {
    competitorNoun: "Sambist",
    competitorNounPlural: "Sambists",
    contestNoun: "Match",
    contestNounPlural: "Matches",
    periodNoun: "Period",
    timed: true,
    teamEvents: false,
    cornerLabels: { red: "Red", blue: "Blue" },
    resultMethods: ["submission", "technical-superiority", "points", "decision-unanimous", "disqualification"],
    scoringLabel: "Points",
  },
};

export function getSportRules(slug: SportSlug): SportRules {
  return SPORT_RULES[slug];
}

/** Human-readable label for a result method within a given sport's context. */
export function methodLabel(method: ResultMethod): string {
  const labels: Record<ResultMethod, string> = {
    ko: "KO",
    tko: "TKO",
    submission: "Submission",
    "decision-unanimous": "Unanimous decision",
    "decision-split": "Split decision",
    "decision-majority": "Majority decision",
    points: "Points",
    pin: "Pin (fall)",
    ippon: "Ippon",
    "technical-superiority": "Technical superiority",
    draw: "Draw",
    disqualification: "Disqualification",
    "no-contest": "No contest",
  };
  return labels[method];
}
