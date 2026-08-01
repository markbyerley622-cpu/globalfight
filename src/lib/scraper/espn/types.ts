// The subset of ESPN's scoreboard payload we actually read.
//
// Deliberately partial and every field optional: this is an undocumented public
// endpoint, so the shape can change without notice. Everything downstream must
// cope with any of it being missing rather than throwing — a provider that
// crashes on one malformed bout loses the whole card.

export interface EspnAthlete {
  id?: string;
  displayName?: string;
  fullName?: string;
  shortName?: string;
}

export interface EspnCompetitor {
  /**
   * In MMA this IS the athlete id (`type: "athlete"`, `uid: "s:3301~a:<id>"`).
   * `athlete.id` is frequently absent, so this is the reliable one.
   */
  id?: string;
  order?: number;
  /** True on the corner ESPN marks as having won. `false` on the loser, absent while scheduled. */
  winner?: boolean;
  athlete?: EspnAthlete;
}

export interface EspnStatus {
  /** Round number the bout was in. */
  period?: number;
  clock?: number;
  displayClock?: string;
  type?: { name?: string; state?: string; completed?: boolean; description?: string };
}

export interface EspnVenue {
  fullName?: string;
  address?: { city?: string; state?: string; country?: string };
}

/** One BOUT. ESPN models a card as an event containing N "competitions". */
export interface EspnCompetition {
  id?: string;
  date?: string;
  /** Weight class lives here: { abbreviation: "Flyweight" | "W Bantamweight" }. */
  type?: { id?: string; abbreviation?: string; text?: string };
  /** { regulation: { periods: 3 } } — scheduled rounds. */
  format?: { regulation?: { periods?: number } };
  status?: EspnStatus;
  venue?: EspnVenue;
  competitors?: EspnCompetitor[];
  notes?: { headline?: string; type?: string }[];
}

/** One CARD. */
export interface EspnEvent {
  id?: string;
  name?: string;
  shortName?: string;
  date?: string;
  status?: EspnStatus;
  competitions?: EspnCompetition[];
}

export interface EspnScoreboard {
  events?: EspnEvent[];
}

export interface EspnReport {
  /** league:year requests issued. */
  requests: number;
  eventsSeen: number;
  boutsSeen: number;
  /** Bouts ESPN marks final with a winner. */
  boutsDecided: number;
  /** Cards ESPN listed with no competitions at all. */
  emptyCards: { league: string; name: string; date: string }[];
  warnings: string[];
}
