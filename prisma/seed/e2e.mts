// ════════════════════════════════════════════════════════════════════════════
//  THE CANONICAL E2E WORLD.
//
//  ── Why this exists ──────────────────────────────────────────────────────
//  The Playwright suite asserted things like "at least one event card links to
//  a detail page" against whatever database it happened to find. On a fresh CI
//  Postgres that is nothing, so 22 tests failed for the same reason: no content.
//  They were not testing the product, they were testing the fixture — and the
//  fixture was the live database.
//
//  ── The rules ────────────────────────────────────────────────────────────
//  DETERMINISTIC IDS. Every row is created with an explicit `id`, so a test can
//  address a bout or a user directly instead of "the first card on the page",
//  which is the single biggest source of flake in a suite like this.
//
//  NO RANDOMNESS. No Math.random, no faker. Two runs produce byte-identical
//  content.
//
//  DATES ARE FIXED OFFSETS from a single `NOW`, captured once. Upcoming fights
//  must genuinely be in the future for the pick-lock rule (picksLocked) to allow
//  a prediction, so they cannot be hard-coded calendar dates that eventually go
//  stale — but every offset is a constant, so the SHAPE of the world never
//  changes.
//
//  IDEMPOTENT. Everything is namespaced `e2e-` and deleted before it is written,
//  so a re-run cannot accumulate or collide.
//
//  NEVER TOUCHES REAL DATA. Every delete is scoped to the `e2e-` prefix.
// ════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../src/lib/db.ts";
import { hashPassword } from "../../src/lib/auth.ts";

const P = "e2e-";
const NOW = new Date();
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

/** The one password every seeded account shares. Tests read it from here. */
export const E2E_PASSWORD = "e2e-Passw0rd!";

export const E2E = {
  admin: { id: `${P}u-admin`, username: "e2eadmin", email: "admin@e2e.local", name: "E2E Admin" },
  primary: { id: `${P}u-primary`, username: "e2eprimary", email: "primary@e2e.local", name: "E2E Primary" },
  rival: { id: `${P}u-rival`, username: "e2erival", email: "rival@e2e.local", name: "E2E Rival" },
  follower: { id: `${P}u-follower`, username: "e2efollower", email: "follower@e2e.local", name: "E2E Follower" },
  upcomingEvent: `${P}event-upcoming`,
  completedEvent: `${P}event-completed`,
  upcomingFight: `${P}fight-upcoming`,
  completedFight: `${P}fight-completed`,
  gym: `${P}gym`,
} as const;

async function wipe() {
  // Child-first, so nothing is orphaned by a restrictive foreign key.
  await prisma.forumReport.deleteMany({ where: { reporter: { email: { endsWith: "@e2e.local" } } } });
  await prisma.forumPost.deleteMany({ where: { thread: { slug: { startsWith: P } } } });
  await prisma.forumThread.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.activity.deleteMany({ where: { user: { email: { endsWith: "@e2e.local" } } } });
  await prisma.notification.deleteMany({ where: { user: { email: { endsWith: "@e2e.local" } } } });
  await prisma.reputationEvent.deleteMany({ where: { user: { email: { endsWith: "@e2e.local" } } } });
  await prisma.battle.deleteMany({ where: { fight: { slug: { startsWith: P } } } });
  await prisma.fightPick.deleteMany({ where: { fight: { slug: { startsWith: P } } } });
  await prisma.gymReview.deleteMany({ where: { gym: { slug: { startsWith: P } } } });
  await prisma.follow.deleteMany({ where: { user: { email: { endsWith: "@e2e.local" } } } });
  await prisma.userFollow.deleteMany({ where: { follower: { email: { endsWith: "@e2e.local" } } } });
  await prisma.fight.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.event.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.gym.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.fighter.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@e2e.local" } } });
}

export async function seedE2E(): Promise<void> {
  await wipe();
  const passwordHash = await hashPassword(E2E_PASSWORD);

  // ── People ───────────────────────────────────────────────────────────────
  // Consent columns are set directly: these accounts exist as if they had
  // already agreed, so a test that only wants a signed-in session does not have
  // to walk the sign-up flow to get one.
  const consent = {
    passwordHash, ageConfirmed: true, ageConfirmedAt: NOW,
    termsAcceptedAt: NOW, emailVerified: NOW,
  };
  for (const [key, u] of Object.entries(E2E)) {
    if (typeof u === "string") continue;
    await prisma.user.create({
      data: {
        id: u.id, username: u.username, email: u.email, name: u.name,
        role: key === "admin" ? "ADMIN" : "USER",
        reputation: key === "primary" ? 1_250 : 100,
        picksResolved: key === "primary" ? 10 : 0,
        picksCorrect: key === "primary" ? 7 : 0,
        pickStreak: key === "primary" ? 3 : 0,
        bestPickStreak: key === "primary" ? 5 : 0,
        ...consent,
      },
    });
  }

  // Follows in BOTH directions, so followers and following pages both have rows.
  await prisma.userFollow.createMany({
    data: [
      { followerId: E2E.follower.id, followingId: E2E.primary.id },
      { followerId: E2E.rival.id, followingId: E2E.primary.id },
      { followerId: E2E.primary.id, followingId: E2E.rival.id },
    ],
    skipDuplicates: true,
  });

  // ── Fighters ─────────────────────────────────────────────────────────────
  const fighters = ["red-a", "blue-a", "red-b", "blue-b"].map((n, i) => ({
    id: `${P}f-${n}`, slug: `${P}fighter-${n}`, name: `E2E Fighter ${n.toUpperCase()}`,
    sport: "MMA" as const, wins: 10 + i, losses: i, draws: 0, koWins: 5 + i,
  }));
  await prisma.fighter.createMany({ data: fighters, skipDuplicates: true });

  // ── Events + fights ──────────────────────────────────────────────────────
  // One UPCOMING (predictable) and one COMPLETED (graded), which is the minimum
  // that exercises both halves of every prediction surface.
  const upcoming = await prisma.event.create({
    data: {
      id: `${P}e-up`, slug: E2E.upcomingEvent, name: "E2E Upcoming Card",
      promotion: "UFC", sport: "MMA", status: "SCHEDULED", date: days(7),
      venue: "E2E Arena", city: "Las Vegas", country: "United States", countryCode: "US",
    },
  });
  const completed = await prisma.event.create({
    data: {
      id: `${P}e-done`, slug: E2E.completedEvent, name: "E2E Completed Card",
      promotion: "ONE Championship", sport: "MMA", status: "COMPLETED", date: days(-7),
      venue: "E2E Dome", city: "Singapore", country: "Singapore", countryCode: "SG",
    },
  });

  await prisma.fight.create({
    data: {
      id: `${P}fi-up`, slug: E2E.upcomingFight, eventId: upcoming.id,
      redId: fighters[0].id, blueId: fighters[1].id,
      scheduledRounds: 5, mainEvent: true, orderOnCard: 0, date: days(7), result: "SCHEDULED",
    },
  });
  await prisma.fight.create({
    data: {
      id: `${P}fi-done`, slug: E2E.completedFight, eventId: completed.id,
      redId: fighters[2].id, blueId: fighters[3].id,
      scheduledRounds: 3, mainEvent: true, orderOnCard: 0, date: days(-7),
      result: "WIN", winnerId: fighters[2].id, method: "KO", roundEnded: 2,
      picksResolvedAt: days(-7),
    },
  });

  // ── Predictions ──────────────────────────────────────────────────────────
  // The primary user has a settled CORRECT call and the rival a settled MISS, so
  // Recent Results renders both verdicts without any test having to create one.
  await prisma.fightPick.createMany({
    data: [
      { userId: E2E.primary.id, fightId: `${P}fi-done`, corner: "RED", method: "KO", correct: true },
      { userId: E2E.rival.id, fightId: `${P}fi-done`, corner: "BLUE", method: "UD", correct: false },
      // Deliberately NO pick for the primary user on the upcoming bout — the
      // prediction test needs an un-picked fight to lock, and a seeded pick
      // would make it assert against an already-committed control.
      { userId: E2E.rival.id, fightId: `${P}fi-up`, corner: "BLUE", method: "UD" },
    ],
    skipDuplicates: true,
  });
  await prisma.reputationEvent.createMany({
    data: [
      { userId: E2E.primary.id, delta: 14, reason: "pick_correct", refType: "fight", refId: `${P}fi-done` },
      { userId: E2E.rival.id, delta: -3, reason: "pick_wrong", refType: "fight", refId: `${P}fi-done` },
    ],
  });

  // ── Challenge ────────────────────────────────────────────────────────────
  await prisma.battle.create({
    data: {
      id: `${P}battle`, fightId: `${P}fi-up`,
      challengerId: E2E.rival.id, challengerCorner: "BLUE",
      opponentId: E2E.primary.id, opponentCorner: "RED",
      state: "ACTIVE", matchedAt: NOW,
    },
  });

  // ── Activity ─────────────────────────────────────────────────────────────
  await prisma.activity.createMany({
    data: [
      { id: `${P}act-1`, userId: E2E.primary.id, type: "PICK_MADE", title: "Locked E2E Fighter RED-B by KO/TKO", url: `/fights/${E2E.completedFight}` },
      { id: `${P}act-2`, userId: E2E.primary.id, type: "PICK_CORRECT", title: "Correctly picked E2E Fighter RED-B", url: `/fights/${E2E.completedFight}` },
      { id: `${P}act-3`, userId: E2E.primary.id, type: "FOLLOW", title: "Followed E2E Rival", url: `/u/${E2E.rival.username}` },
    ],
  });

  // ── Notifications ────────────────────────────────────────────────────────
  await prisma.notification.createMany({
    data: [
      { id: `${P}n-1`, userId: E2E.primary.id, type: "PICK_RESULT", title: "Your call landed", body: "E2E Fighter RED-B won by KO.", url: `/fights/${E2E.completedFight}` },
      { id: `${P}n-2`, userId: E2E.primary.id, type: "FOLLOW", title: "E2E Follower started following you", url: `/u/${E2E.follower.username}` },
    ],
  });

  // ── Gym + review ─────────────────────────────────────────────────────────
  const gym = await prisma.gym.create({
    data: {
      id: `${P}g`, slug: E2E.gym, name: "E2E Combat Gym",
      city: "Brisbane", country: "Australia", disciplines: ["MMA", "Muay Thai"],
    },
  });
  await prisma.gymReview.create({
    data: { id: `${P}gr`, gymId: gym.id, authorId: E2E.follower.id, overall: 5, title: "Excellent room", body: "Excellent coaching and a welcoming room." },
  });
  await prisma.follow.createMany({
    data: [
      { userId: E2E.primary.id, targetType: "gym", targetId: gym.id },
      { userId: E2E.rival.id, targetType: "gym", targetId: gym.id },
    ],
    skipDuplicates: true,
  });

  // ── Discussion + a report for the moderator queue ─────────────────────────
  const category = await prisma.forumCategory.findFirst({ select: { id: true, slug: true } });
  if (category) {
    const thread = await prisma.forumThread.create({
      data: {
        id: `${P}t`, slug: `${P}thread`, title: "E2E discussion thread",
        categoryId: category.id, authorId: E2E.primary.id, visibility: "public",
        posts: { create: { id: `${P}p-op`, authorId: E2E.primary.id, content: "Opening post for the E2E world." } },
      },
    });
    const reply = await prisma.forumPost.create({
      data: { id: `${P}p-reply`, threadId: thread.id, authorId: E2E.rival.id, content: "A reply that has been reported." },
    });
    // An OPEN report, so the moderator console has something to action.
    await prisma.forumReport.create({
      data: { id: `${P}rep`, targetType: "post", targetId: reply.id, reporterId: E2E.follower.id, reason: "spam", status: "OPEN" },
    });
  }
}

// Runnable directly: `npm run seed:e2e`.
seedE2E()
  .then(() => { console.log("[seed:e2e] canonical world ready"); return prisma.$disconnect(); })
  .catch(async (e) => { console.error("[seed:e2e] failed:", e); await prisma.$disconnect(); process.exit(1); });
