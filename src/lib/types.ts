// Domain types mirroring the Prisma models. The mock-data layer and the
// future Postgres layer both satisfy these, so UI components never change.

export type Sport =
  | "BOXING" | "MMA" | "MUAY_THAI" | "KICKBOXING" | "K1" | "BARE_KNUCKLE"
  | "BJJ" | "BJJ_NOGI" | "WRESTLING" | "JUDO" | "TAEKWONDO" | "SAMBO" | "COMBAT_SAMBO";
export type Stance = "ORTHODOX" | "SOUTHPAW" | "SWITCH";
export type RankMovement = "UP" | "DOWN" | "SAME" | "NEW" | "RETURN";
export type SanctioningBody = "WBA" | "WBC" | "IBF" | "WBO" | "RING";
export type FightResult = "WIN" | "LOSS" | "DRAW" | "NO_CONTEST" | "SCHEDULED";
export type FightMethod =
  | "KO" | "TKO" | "UD" | "SD" | "MD" | "SUB" | "DQ" | "RTD" | "TD" | "NC" | "DRAW";
export type EventStatus =
  | "ANNOUNCED" | "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED" | "POSTPONED";

export interface Fighter {
  id: string;
  slug: string;
  name: string;
  nickname?: string;
  sport: Sport;
  nationality?: string;
  countryCode?: string;
  birthDate?: string;
  birthPlace?: string;
  residence?: string;
  heightCm?: number;
  reachCm?: number;
  stance?: Stance;
  debutDate?: string;
  gym?: string;
  promoter?: string;
  wins: number;
  losses: number;
  draws: number;
  noContests: number;
  koWins: number;
  koLosses: number;
  totalRounds: number;
  thumbUrl?: string;
  imageUrl?: string;
  heroImageUrl?: string;
  // Licensed external photo (Wikimedia Commons) + attribution for the credit line.
  photoUrl?: string;
  photoSource?: string;
  photoCredit?: string;
  photoLicense?: string;
  photoLicenseUrl?: string;
  active: boolean;
  bio?: string;
  titles?: { body: SanctioningBody; weight: string; current: boolean }[];
}

// Slim row for the paginated fighters directory (list view).
export interface FighterListItem {
  slug: string;
  name: string;
  nickname?: string;
  sport: Sport;
  nationality?: string;
  countryCode?: string;
  residence?: string;
  wins: number;
  losses: number;
  draws: number;
  noContests: number;
  active: boolean;
  thumbUrl?: string;
  imageUrl?: string;
  website?: string;
  promoter?: string;
  claimed: boolean;
}

export interface RankedFighter {
  rank: number;
  previousRank?: number;
  movement: RankMovement;
  rating?: number;
  fighter: Fighter;
}

export interface WeightClassRanking {
  weightClass: string;
  slug: string;
  isPoundForPound: boolean;
  rankings: RankedFighter[];
  updatedAt: string;
}

export interface Champion {
  body: SanctioningBody;
  weightClass: string;
  weightClassSlug: string;
  since?: string;
  defenses: number;
  fighter: Fighter;
}

export interface FightEvent {
  id: string;
  slug: string;
  name: string;
  sport: Sport;
  promotion?: string;
  venue?: string;
  city?: string;
  country?: string;
  countryCode?: string;
  broadcaster?: string;
  posterUrl?: string;
  date: string;
  status: EventStatus;
  fights: Fight[];
}

export interface Fight {
  id: string;
  slug: string;
  red: Fighter;
  blue: Fighter;
  weightClass?: string;
  scheduledRounds: number;
  titleFight: boolean;
  mainEvent: boolean;
  coMain: boolean;
  result: FightResult;
  winnerId?: string;
  method?: FightMethod;
  roundEnded?: number;
  timeEnded?: string;
  date: string;
  prediction?: FightPrediction;
  odds?: Odds[];
}

export interface FightPrediction {
  redProbability: number;  // 0..1
  blueProbability: number;
  methodPrediction?: FightMethod;
  roundPrediction?: number;
  communityRed?: number;
  expertRed?: number;
  confidence?: number;
  rationale?: string;
}

export interface Odds {
  bookmaker: string;
  redOdds: number;
  blueOdds: number;
  redImplied: number;
  blueImplied: number;
}

export interface Article {
  id: string;
  slug: string;
  title: string;
  excerpt?: string;
  content?: string;
  category: string;
  featured: boolean;
  coverImageUrl?: string;
  sourceUrl?: string;
  author?: string;
  views: number;
  publishedAt: string;
}

export interface ForumThread {
  id: string;
  slug: string;
  title: string;
  category: string;
  categorySlug: string;
  author: string;
  replyCount: number;
  views: number;
  lastPostAt: string;
  pinned: boolean;
}
