import "server-only";
import type { Sport } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createThread } from "@/lib/forum/repo";
import type {
  BattleRoomDTO, BattleRoomState, Corner, FightRoomDTO, RoomIdentity, RoomThreadRef,
} from "@/lib/community/room-types";

// ════════════════════════════════════════════════════════════════════════════
//  Rooms — the discussion architecture.
//
//  Discussion is FIGHT-scoped, not event-scoped. Every fight owns one arena
//  with two layers:
//
//    Layer 1  Battle Room     private, the two paired predictors, rivalry grows
//    Layer 2  Community Room   public, spectators, analysis, memes
//
//  Both are ordinary ForumThreads (posts, reactions, quotes, realtime, reports)
//  — nothing about the discussion stack is duplicated, only scoped and gated.
//  Rooms are provisioned on FIRST OPEN, never during a page render.
// ════════════════════════════════════════════════════════════════════════════

const SYSTEM_EMAIL = "system@combatreviews.local";
let systemUserId: string | null = null;

/** The account that authors auto-provisioned rooms (so no member can delete one). */
async function ensureSystemUser(): Promise<string> {
  if (systemUserId) return systemUserId;
  const u = await prisma.user.upsert({
    where: { email: SYSTEM_EMAIL },
    update: {},
    create: { email: SYSTEM_EMAIL, name: "Combat Reviews", username: "combatreviews", registryRole: "media" },
    select: { id: true },
  });
  systemUserId = u.id;
  return u.id;
}

// Sport → forum category slug (categories are seeded in forum/repo.ts). A room
// still belongs to a discipline board, so moderation and taxonomy are unchanged.
const SPORT_CATEGORY: Partial<Record<Sport, string>> = {
  MMA: "mma", BOXING: "boxing", MUAY_THAI: "muay-thai", KICKBOXING: "kickboxing", K1: "kickboxing",
  BARE_KNUCKLE: "bare-knuckle", BJJ: "bjj", BJJ_NOGI: "bjj", WRESTLING: "wrestling",
  JUDO: "judo", TAEKWONDO: "taekwondo", SAMBO: "sambo", COMBAT_SAMBO: "sambo",
};
const categoryForSport = (s: Sport | null | undefined) => (s && SPORT_CATEGORY[s]) || "general";

const THREAD_REF = { slug: true, category: { select: { slug: true } }, locked: true, replyCount: true } as const;
type ThreadRefRow = { slug: string; category: { slug: string }; locked: boolean; replyCount: number };
const asRef = (t: ThreadRefRow): RoomThreadRef => ({
  slug: t.slug, categorySlug: t.category.slug, locked: t.locked, replyCount: t.replyCount,
});

/** Create-once with a race fallback (the room link is @unique, so a lost race
 *  just means someone else provisioned it first). */
async function provision(find: () => Promise<RoomThreadRef | null>, make: () => Promise<RoomThreadRef>): Promise<RoomThreadRef> {
  const existing = await find();
  if (existing) return existing;
  try {
    return await make();
  } catch {
    const now = await find();
    if (now) return now;
    throw new Error("Could not open this room");
  }
}

// ── Layer 2: the fight's public community room ───────────────────────────────
type FightForRoom = {
  id: string; slug: string; red: { name: string; sport: Sport }; blue: { name: string };
  event: { name: string } | null;
};

export async function getOrCreateCommunityRoom(fight: FightForRoom): Promise<RoomThreadRef> {
  return provision(
    async () => {
      const t = await prisma.forumThread.findUnique({ where: { fightId: fight.id }, select: THREAD_REF });
      return t ? asRef(t) : null;
    },
    async () => {
      const author = await ensureSystemUser();
      const t = await createThread({
        authorId: author,
        categorySlug: categoryForSport(fight.red.sport),
        title: `${fight.red.name} vs ${fight.blue.name}`.slice(0, 155),
        content: `Everything on **${fight.red.name} vs ${fight.blue.name}**${fight.event ? ` at ${fight.event.name}` : ""} — reads, tape, tactics, trash talk. Make your pick, then defend it.`,
        fightId: fight.id,
        kind: "discussion",
      });
      return { slug: t.slug, categorySlug: t.categorySlug, locked: t.locked, replyCount: t.replyCount };
    },
  );
}

// ── Layer 1: the battle's private room ───────────────────────────────────────
export async function getOrCreateBattleRoom(battle: {
  id: string; challenger: { name: string | null; username: string | null }; opponent: { name: string | null; username: string | null } | null;
}, fight: FightForRoom): Promise<RoomThreadRef> {
  const who = (u: { name: string | null; username: string | null } | null) => u?.name ?? u?.username ?? "Challenger";
  return provision(
    async () => {
      const t = await prisma.forumThread.findUnique({ where: { battleId: battle.id }, select: THREAD_REF });
      return t ? asRef(t) : null;
    },
    async () => {
      const author = await ensureSystemUser();
      const t = await createThread({
        authorId: author,
        categorySlug: categoryForSport(fight.red.sport),
        title: `Battle · ${who(battle.challenger)} vs ${who(battle.opponent)} · ${fight.red.name}–${fight.blue.name}`.slice(0, 155),
        content: `You two called it differently. ${fight.red.name} vs ${fight.blue.name} settles it — no moderators, no votes, just the result.`,
        battleId: battle.id,
        visibility: "battle",
        kind: "discussion",
      });
      return { slug: t.slug, categorySlug: t.categorySlug, locked: t.locked, replyCount: t.replyCount };
    },
  );
}

// ── Identity ─────────────────────────────────────────────────────────────────
const isCorner = (v: unknown): v is Corner => v === "RED" || v === "BLUE";

type UserBits = { id: string; name: string | null; username: string | null; image: string | null; reputation: number; battleStreak: number };
type PickBits = { corner: string; method: string | null; confidence: number | null };

function identity(
  u: UserBits,
  pick: PickBits | undefined,
  fight: { red: { name: string }; blue: { name: string } },
  h2h: { you: number; them: number; draws: number } | null,
): RoomIdentity {
  const corner = pick && isCorner(pick.corner) ? pick.corner : null;
  return {
    userId: u.id,
    name: u.name ?? u.username ?? "Member",
    username: u.username,
    image: u.image,
    corner,
    fighter: corner ? (corner === "RED" ? fight.red.name : fight.blue.name) : null,
    method: pick?.method ?? null,
    confidence: pick?.confidence ?? null,
    headToHead: h2h,
    battleStreak: u.battleStreak,
    reputation: u.reputation,
  };
}

const USER_BITS = { id: true, name: true, username: true, image: true, reputation: true, battleStreak: true } as const;

// ── The room payload — ONE call per opened arena ─────────────────────────────
/**
 * Everything an opened fight arena needs: both discussion layers, the battle
 * banner, and identity for every speaker. Provisions the rooms on the way
 * through. Batched with Promise.all — no query runs that another could have
 * answered, and nothing here executes on a page render.
 */
export async function getFightRoom(fightSlug: string, viewerId?: string): Promise<FightRoomDTO | null> {
  const fight = await prisma.fight.findUnique({
    where: { slug: fightSlug },
    select: {
      id: true, slug: true, date: true, result: true,
      red: { select: { name: true, sport: true } },
      blue: { select: { name: true } },
      event: { select: { name: true, date: true } },
    },
  });
  if (!fight) return null;

  const community = await getOrCreateCommunityRoom(fight);

  const [myPick, battleRow, speakerRows] = await Promise.all([
    viewerId
      ? prisma.fightPick.findUnique({ where: { userId_fightId: { userId: viewerId, fightId: fight.id } }, select: { corner: true, method: true, confidence: true } })
      : Promise.resolve(null),
    viewerId ? loadViewerBattle(fight.id, viewerId) : Promise.resolve(null),
    loadSpeakers(community.slug),
  ]);

  // Speaker identity: who has spoken, what they picked, and how they stand
  // against the viewer. Three queries, bounded by the room's participants.
  const speakerIds = speakerRows.map((s) => s.id);
  const [speakerPicks, rivalries] = await Promise.all([
    speakerIds.length
      ? prisma.fightPick.findMany({ where: { fightId: fight.id, userId: { in: speakerIds } }, select: { userId: true, corner: true, method: true, confidence: true } })
      : Promise.resolve([]),
    viewerId && speakerIds.length
      ? prisma.rivalry.findMany({
          where: { OR: [{ userAId: viewerId, userBId: { in: speakerIds } }, { userBId: viewerId, userAId: { in: speakerIds } }] },
        })
      : Promise.resolve([]),
  ]);

  const pickByUser = new Map(speakerPicks.map((p) => [p.userId, p]));
  const h2hByUser = new Map<string, { you: number; them: number; draws: number }>();
  for (const r of rivalries) {
    const other = r.userAId === viewerId ? r.userBId : r.userAId;
    h2hByUser.set(other, r.userAId === viewerId
      ? { you: r.aWins, them: r.bWins, draws: r.draws }
      : { you: r.bWins, them: r.aWins, draws: r.draws });
  }

  const speakers: Record<string, RoomIdentity> = {};
  for (const u of speakerRows) {
    speakers[u.id] = identity(u, pickByUser.get(u.id), fight, h2hByUser.get(u.id) ?? null);
  }

  // Picks close at the first bell for the whole card (same rule as castPick).
  const started = fight.event?.date ? fight.event.date.getTime() <= Date.now() : false;

  return {
    fightSlug: fight.slug,
    fightDate: fight.date.toISOString(),
    redName: fight.red.name,
    blueName: fight.blue.name,
    locked: started || fight.result !== "SCHEDULED",
    community,
    battle: battleRow ? await buildBattleDTO(battleRow, fight, viewerId!) : null,
    speakers,
    myCorner: myPick && isCorner(myPick.corner) ? myPick.corner : null,
  };
}

/** Distinct authors in a room, newest speakers first. Capped — a room with 500
 *  voices does not need 500 identity cards to render its visible page. */
async function loadSpeakers(threadSlug: string): Promise<UserBits[]> {
  const rows = await prisma.forumPost.findMany({
    where: { thread: { slug: threadSlug }, deleted: false },
    distinct: ["authorId"],
    orderBy: { createdAt: "desc" },
    take: 120,
    select: { author: { select: USER_BITS } },
  });
  return rows.map((r) => r.author);
}

const BATTLE_SELECT = {
  id: true, state: true, winnerId: true, fightId: true,
  challengerId: true, challengerCorner: true, challengerMethod: true, challengerConfidence: true,
  opponentId: true, opponentCorner: true, opponentMethod: true, opponentConfidence: true,
  challenger: { select: USER_BITS },
  opponent: { select: USER_BITS },
  room: { select: THREAD_REF },
} as const;
type BattleRow = Awaited<ReturnType<typeof loadViewerBattle>>;

/** The viewer's battle on this bout: the live one, else the most recent settled
 *  one (so a resolved rivalry still has somewhere to talk). */
function loadViewerBattle(fightId: string, viewerId: string) {
  return prisma.battle.findFirst({
    where: { fightId, OR: [{ challengerId: viewerId }, { opponentId: viewerId }] },
    orderBy: [{ state: "asc" }, { createdAt: "desc" }],
    select: BATTLE_SELECT,
  });
}

async function buildBattleDTO(
  b: NonNullable<BattleRow>,
  fight: FightForRoom & { red: { name: string; sport: Sport }; blue: { name: string } },
  viewerId: string,
): Promise<BattleRoomDTO> {
  const iAmChallenger = b.challengerId === viewerId;
  const meUser = iAmChallenger ? b.challenger : b.opponent!;
  const themUser = iAmChallenger ? b.opponent : b.challenger;
  const myPick = { corner: iAmChallenger ? b.challengerCorner : b.opponentCorner ?? "", method: iAmChallenger ? b.challengerMethod : b.opponentMethod, confidence: iAmChallenger ? b.challengerConfidence : b.opponentConfidence };
  const theirPick = themUser
    ? { corner: (iAmChallenger ? b.opponentCorner : b.challengerCorner) ?? "", method: iAmChallenger ? b.opponentMethod : b.challengerMethod, confidence: iAmChallenger ? b.opponentConfidence : b.challengerConfidence }
    : undefined;

  const rivalry = themUser
    ? await prisma.rivalry.findUnique({
        where: { userAId_userBId: viewerId < themUser.id ? { userAId: viewerId, userBId: themUser.id } : { userAId: themUser.id, userBId: viewerId } },
      })
    : null;
  const mineIsA = rivalry ? rivalry.userAId === viewerId : false;
  const record = rivalry
    ? { you: mineIsA ? rivalry.aWins : rivalry.bWins, them: mineIsA ? rivalry.bWins : rivalry.aWins, draws: rivalry.draws }
    : { you: 0, them: 0, draws: 0 };

  // The private room exists only once there is someone to talk to.
  let thread: RoomThreadRef | null = b.room ? asRef(b.room) : null;
  if (!thread && b.opponentId) {
    thread = await getOrCreateBattleRoom({ id: b.id, challenger: b.challenger, opponent: b.opponent }, fight);
  }

  return {
    id: b.id,
    state: b.state as BattleRoomState,
    thread,
    you: identity(meUser, myPick.corner ? myPick : undefined, fight, null),
    opponent: themUser ? identity(themUser, theirPick?.corner ? theirPick : undefined, fight, record) : null,
    record,
    streak: { mine: rivalry?.currentStreakUserId === viewerId, count: rivalry?.currentStreak ?? 0 },
    meetings: record.you + record.them + record.draws,
    winnerId: b.winnerId,
  };
}

// ── Batched summaries for the card ───────────────────────────────────────────
export interface RoomSummary {
  /** Public messages in the fight's community room. */
  voices: number;
  /** The viewer's battle on this bout, if any. */
  battle: { state: BattleRoomState; opponentName: string | null; opponentImage: string | null; unreadHint: number } | null;
}

/**
 * Room counts for a whole card in THREE queries — the event page renders every
 * fight module without an N+1 and without provisioning anything. Degrades to an
 * empty map if the room tables aren't migrated yet, so the page never breaks.
 */
export async function getRoomSummaries(fightIds: string[], viewerId?: string): Promise<Map<string, RoomSummary>> {
  const out = new Map<string, RoomSummary>();
  if (!fightIds.length) return out;
  for (const id of fightIds) out.set(id, { voices: 0, battle: null });
  try {
    const [threads, battles] = await Promise.all([
      prisma.forumThread.findMany({ where: { fightId: { in: fightIds } }, select: { fightId: true, replyCount: true } }),
      viewerId
        ? prisma.battle.findMany({
            where: { fightId: { in: fightIds }, OR: [{ challengerId: viewerId }, { opponentId: viewerId }] },
            select: {
              fightId: true, state: true, messageCount: true, challengerId: true,
              challenger: { select: { name: true, username: true, image: true } },
              opponent: { select: { name: true, username: true, image: true } },
            },
          })
        : Promise.resolve([]),
    ]);
    for (const t of threads) {
      if (t.fightId) out.get(t.fightId)!.voices = t.replyCount;
    }
    for (const b of battles) {
      const them = b.challengerId === viewerId ? b.opponent : b.challenger;
      out.get(b.fightId)!.battle = {
        state: b.state as BattleRoomState,
        opponentName: them?.name ?? them?.username ?? null,
        opponentImage: them?.image ?? null,
        unreadHint: b.messageCount,
      };
    }
  } catch {
    /* Room columns not migrated yet — the card still renders, just without counts. */
  }
  return out;
}
