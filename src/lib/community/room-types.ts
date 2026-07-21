// Room DTOs — client + server safe (no server-only imports here), so the room
// endpoint and the client components share one shape.

export type Corner = "RED" | "BLUE";

/** Everything needed to understand who is talking WITHOUT opening a profile. */
export interface RoomIdentity {
  userId: string;
  name: string;
  username: string | null;
  image: string | null;
  /** The corner they backed on this bout (null = spectator, no pick). */
  corner: Corner | null;
  /** The fighter that corner is — so a message reads "Alex · Islam · KO ★★★★★". */
  fighter: string | null;
  method: string | null;
  confidence: number | null;
  /** Battle record vs the VIEWER, when they have met before. */
  headToHead: { you: number; them: number; draws: number } | null;
  /** Their current battle streak. */
  battleStreak: number;
  reputation: number;
}

export interface RoomThreadRef {
  slug: string;
  categorySlug: string;
  locked: boolean;
  replyCount: number;
}

export type BattleRoomState = "WAITING" | "ACTIVE" | "RESOLVED" | "CANCELLED" | "EXPIRED";

export interface BattleRoomDTO {
  id: string;
  state: BattleRoomState;
  /** The private two-person room. Null only while the battle is still WAITING. */
  thread: RoomThreadRef | null;
  you: RoomIdentity;
  opponent: RoomIdentity | null;
  /** Head-to-head across every battle the pair has settled. */
  record: { you: number; them: number; draws: number };
  /** Who is on the active streak, and how long. */
  streak: { mine: boolean; count: number };
  /** How many times this pair has met (the rematch history). */
  meetings: number;
  winnerId: string | null;
}

/** One fight's arena: the private battle layer + the public community layer. */
export interface FightRoomDTO {
  fightSlug: string;
  fightDate: string;
  redName: string;
  blueName: string;
  locked: boolean; // picks closed (card started / bout decided)
  community: RoomThreadRef;
  battle: BattleRoomDTO | null;
  /** Identity for everyone who has spoken in the community room. */
  speakers: Record<string, RoomIdentity>;
  /** The viewer's own pick, so the room can always show what they are defending. */
  myCorner: Corner | null;
}
