/**
 * GlobalFight domain model.
 *
 * The EVENT is the central object. Every other content type — coverage,
 * predictions, discussion, results — attaches to an event (and optionally to a
 * specific bout within it) through stable IDs, never through text matching.
 *
 * Relationship summary:
 *   Sport            has many Promotions, Events
 *   Promotion        has many Events
 *   Event            belongs to one Sport + one Promotion; has many Fights
 *   Fight            belongs to one Event; has 2+ FightParticipants
 *   Article          belongs to an Event; may belong to a Fight
 *   PredictionMarket belongs to a Fight
 *   PredictionVote   belongs to a PredictionMarket + User
 *   DiscussionThread belongs to an Event; may optionally scope to a Fight
 *   FightResult      belongs to a Fight
 */

// --- Branded ID aliases -----------------------------------------------------
// Kept as string aliases for skeleton simplicity while documenting intent.
export type SportId = string;
export type PromotionId = string;
export type EventId = string;
export type FightId = string;
export type AthleteId = string;
export type ArticleId = string;
export type MarketId = string;
export type VoteId = string;
export type ThreadId = string;
export type PostId = string;
export type UserId = string;
export type VenueId = string;

export type Slug = string;

// --- Enumerations -----------------------------------------------------------

/** Every supported combat sport. */
export type SportSlug =
  | "mma"
  | "boxing"
  | "muay-thai"
  | "kickboxing"
  | "bare-knuckle"
  | "bjj"
  | "wrestling"
  | "judo"
  | "taekwondo"
  | "sambo";

/** Lifecycle state of an event. Drives most of the UI. */
export type EventStatus =
  | "announced"
  | "scheduled"
  | "live"
  | "completed"
  | "cancelled"
  | "postponed";

/** Lifecycle state of a single bout within an event. */
export type FightStatus = "scheduled" | "live" | "completed" | "cancelled";

/** Segment of the card a bout sits on. */
export type CardSegment = "main-event" | "main-card" | "prelims" | "early-prelims";

/** Corner assignment. Generic across striking + grappling. */
export type Corner = "red" | "blue";

/** How a bout was decided. Superset across all sports; each sport enables a subset. */
export type ResultMethod =
  | "ko"
  | "tko"
  | "submission"
  | "decision-unanimous"
  | "decision-split"
  | "decision-majority"
  | "points"
  | "pin"
  | "ippon"
  | "technical-superiority"
  | "draw"
  | "disqualification"
  | "no-contest";

export type ArticleType =
  | "preview"
  | "fight-breakdown"
  | "press-conference"
  | "weigh-in"
  | "interview"
  | "injury-update"
  | "announcement"
  | "broadcast"
  | "post-event-report";

export type ModerationState = "visible" | "pending" | "hidden" | "removed";

// --- Core entities ----------------------------------------------------------

export interface Sport {
  id: SportId;
  slug: SportSlug;
  name: string;
  /** One-word label for the discipline family, e.g. "Striking", "Grappling". */
  family: "striking" | "grappling" | "mixed";
  /** Short emoji/icon token used by the switcher when no artwork exists. */
  icon: string;
  accentColor: string;
}

export interface Promotion {
  id: PromotionId;
  slug: Slug;
  sportId: SportId;
  name: string;
  shortName: string;
  country?: string;
}

export interface Venue {
  id: VenueId;
  name: string;
  city: string;
  country: string;
  /** IANA timezone, e.g. "America/Las_Vegas". */
  timezone: string;
}

export interface Broadcast {
  region: string;
  channel: string;
  kind: "ppv" | "streaming" | "tv" | "free";
}

export interface Athlete {
  id: AthleteId;
  slug: Slug;
  name: string;
  nickname?: string;
  country: string;
  /** ISO 3166-1 alpha-2 for flag rendering. */
  countryCode: string;
  record?: FighterRecord;
  imageUrl?: string;
}

export interface FighterRecord {
  wins: number;
  losses: number;
  draws: number;
  /** Optional, sport-specific breakdown (e.g. KOs, submissions). */
  notes?: string;
}

/** A competitor slot on an event (used for headline framing / team events). */
export interface EventParticipant {
  athleteId: AthleteId;
  role: "headliner" | "co-headliner" | "card";
}

export interface FightParticipant {
  athleteId: AthleteId;
  corner: Corner;
  /** Divisional ranking at time of booking, if any. 0 = champion. */
  ranking?: number;
  /** Weight in kg made at the official weigh-in, if recorded. */
  weighInKg?: number;
}

export interface Fight {
  id: FightId;
  slug: Slug;
  eventId: EventId;
  /** 1 = opening bout; the main event has the highest order. */
  boutOrder: number;
  segment: CardSegment;
  weightClass: string;
  /** Scheduled rounds (striking) or period count (grappling); null if N/A. */
  scheduledRounds: number | null;
  /** Round length or match duration in seconds, if fixed. */
  roundLengthSec?: number | null;
  titleFight: boolean;
  status: FightStatus;
  participants: FightParticipant[];
  resultId?: FightId; // result shares the fight id; see FightResult
}

export interface FightResult {
  fightId: FightId;
  method: ResultMethod;
  /** Winning corner; null for draw / no-contest. */
  winnerCorner: Corner | null;
  endRound?: number;
  endTimeSec?: number;
  /** Human-readable summary, e.g. "Rear-naked choke" or "48-47, 48-47, 47-48". */
  detail?: string;
}

export interface Event {
  id: EventId;
  slug: Slug;
  sportId: SportId;
  promotionId: PromotionId;
  name: string;
  status: EventStatus;
  /** ISO 8601 UTC instant of the (main-card) start. */
  startsAt: string;
  /** ISO 8601 UTC instant the main card is expected to begin, if different. */
  mainCardStartsAt?: string;
  venueId: VenueId;
  broadcasts: Broadcast[];
  /** Ordered fight ids for quick card assembly; source of truth is Fight.eventId. */
  fightIds: FightId[];
  headlineFightId?: FightId;
  description?: string;
  posterUrl?: string;
}

// --- Coverage ---------------------------------------------------------------

export interface Article {
  id: ArticleId;
  slug: Slug;
  eventId: EventId;
  fightId?: FightId;
  sportId: SportId;
  promotionId?: PromotionId;
  type: ArticleType;
  title: string;
  excerpt: string;
  publishedAt: string;
  imageUrl?: string;
  author: string;
  source: string;
  tags: string[];
}

// --- Predictions ------------------------------------------------------------

/** A prediction market is opened per bout. Options mirror the bout's corners. */
export interface PredictionMarket {
  id: MarketId;
  fightId: FightId;
  eventId: EventId;
  /** When the market locks (bout start). ISO 8601 UTC. */
  locksAt: string;
  status: "open" | "locked" | "settled";
  options: PredictionOption[];
  totalVotes: number;
}

export interface PredictionOption {
  corner: Corner;
  athleteId: AthleteId;
  votes: number;
}

export interface PredictionVote {
  id: VoteId;
  marketId: MarketId;
  userId: UserId;
  corner: Corner;
  createdAt: string;
}

// --- Community discussion ---------------------------------------------------

export interface DiscussionThread {
  id: ThreadId;
  eventId: EventId;
  /** Optional narrowing to a specific bout. */
  fightId?: FightId;
  title: string;
  postCount: number;
}

export interface DiscussionAuthor {
  id: UserId;
  handle: string;
  /** Community-reputation score, drives "most respected" sorting. */
  reputation: number;
  avatarUrl?: string;
}

export interface DiscussionPost {
  id: PostId;
  threadId: ThreadId;
  eventId: EventId;
  fightId?: FightId;
  author: DiscussionAuthor;
  body: string;
  createdAt: string;
  /** Which phase of the event the post belongs to. */
  phase: "pre-event" | "live" | "post-event";
  replyCount: number;
  reactionCount: number;
  moderation: ModerationState;
}

/** Seed prompt shown to spark discussion — contextual to the event phase. */
export interface DiscussionPrompt {
  id: string;
  eventId: EventId;
  fightId?: FightId;
  phase: "pre-event" | "live" | "post-event";
  text: string;
}
