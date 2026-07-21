import type { CardRarity, FightMethod, NotificationType, ActivityType, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../../src/lib/db.ts";
import { resolvePromotion } from "../../src/lib/promotions.ts";
import { Rng, pastMoment, daysAgo } from "./rng.mts";
import {
  ARCHETYPES, NAMES, CITIES, GYMS, COMMENT_BANKS, TOPIC_BANK, FIGHTER_BANK, TOPIC_TITLES,
  type Persona,
} from "./pools.mts";

export const SEED_EMAIL_DOMAIN = "@seed.local";

// ── Inlined pure helpers ────────────────────────────────────────────────────
// The production versions live in src/lib/{reputation,collectibles,auth}, but
// those modules `import "server-only"` (which throws under a plain node script)
// and auth pulls next/headers. These are byte-for-byte the same tiny functions,
// kept in sync deliberately so the seed exercises the identical scoring the
// resolution engine (resolve.ts + P0-3) uses — not a divergent fake.

/** Mirror of reputation.ts::pickReputation — rewards upset calls + confidence. */
function pickReputation(o: { upsetFactor: number; confidence: number | null; streak: number }): number {
  const upset = Math.max(0, Math.min(1, o.upsetFactor));
  const conf = o.confidence ?? 3;
  const base = 4 + Math.round(16 * upset);
  const mult = 0.7 + 0.1 * conf;
  return Math.round(base * mult) + Math.min(o.streak, 5) * 2;
}

/** Mirror of collectibles.ts::rarityForFight — card rarity from bout stakes. */
function rarityForFight(f: { titleFight: boolean; mainEvent: boolean; coMain: boolean }): CardRarity {
  if (f.titleFight) return "CHAMPION";
  if (f.mainEvent) return "EPIC";
  if (f.coMain) return "RARE";
  return "BASE";
}

// The official forum categories (mirror of forum's ensureForumSeed slugs), so
// seeded discussion lands in the same communities the app renders.
const FORUM_CATEGORIES: [string, string][] = [
  ["mma", "MMA"], ["boxing", "Boxing"], ["muay-thai", "Muay Thai"], ["kickboxing", "Kickboxing"],
  ["bare-knuckle", "Bare Knuckle"], ["bjj", "BJJ"], ["wrestling", "Wrestling"], ["judo", "Judo"],
  ["taekwondo", "Taekwondo"], ["sambo", "Sambo"], ["general", "General"], ["industry", "Industry"],
];
async function ensureCategories() {
  for (let i = 0; i < FORUM_CATEGORIES.length; i++) {
    const [slug, name] = FORUM_CATEGORIES[i];
    await prisma.forumCategory.upsert({ where: { slug }, update: {}, create: { slug, name, order: i } });
  }
}

// ── Types for the in-memory people we build ─────────────────────────────────
interface SeedUser {
  id: string;
  persona: Persona;
  name: string;
  username: string;
  createdAt: Date;
  gym: string;
  city: string;
  // running tallies populated by grading
  reputation: number;
  resolved: number;
  correct: number;
  streak: number;
  bestStreak: number;
}

const CATEGORY_FOR_SPORT: Record<string, string> = {
  MMA: "mma", BOXING: "boxing", MUAY_THAI: "muay-thai", KICKBOXING: "kickboxing", K1: "kickboxing",
  BARE_KNUCKLE: "bare-knuckle", BJJ: "bjj", BJJ_NOGI: "bjj", WRESTLING: "wrestling", JUDO: "judo",
  TAEKWONDO: "taekwondo", SAMBO: "sambo", COMBAT_SAMBO: "sambo",
};

const slugifyThread = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "thread";

function methodFor(p: Persona, rng: Rng): FightMethod {
  const ko = ["KO", "TKO"] as FightMethod[];
  const dec = ["UD", "SD", "MD"] as FightMethod[];
  switch (p.methodBias) {
    case "ko": return rng.pick(ko);
    case "sub": return "SUB" as FightMethod;
    case "decision": return rng.pick(dec);
    default: return rng.pick([...ko, ...dec, "SUB" as FightMethod]);
  }
}

function confidenceFor(p: Persona, rng: Rng): number {
  if (p.confidence === "high") return rng.int(4, 5);
  if (p.confidence === "low") return rng.weighted([{ value: 1, weight: 2 }, { value: 2, weight: 3 }, { value: 3, weight: 2 }]);
  return rng.int(2, 4);
}

const activityPickProb = (a: Persona["activity"]) => (a === "whale" ? 0.72 : a === "regular" ? 0.42 : 0.16);

// ════════════════════════════════════════════════════════════════════════════
//  Build the population
// ════════════════════════════════════════════════════════════════════════════
async function buildUsers(rng: Rng, now: number): Promise<SeedUser[]> {
  const passwordHash = await bcrypt.hash("demo-passw0rd", 10); // one hash, reused — all demo logins are "demo-passw0rd"
  const used = new Set<string>();
  const rows: Prisma.UserCreateManyInput[] = [];
  const meta: Omit<SeedUser, "id">[] = [];

  for (const p of ARCHETYPES) {
    for (let i = 0; i < p.count; i++) {
      const pool = NAMES[p.region];
      const first = rng.pick(pool.first);
      const last = rng.pick(pool.last);
      const name = `${first} ${last}`;
      let handle = `${first}${last}`.toLowerCase().replace(/[^a-z0-9]/g, "");
      while (used.has(handle)) handle = `${handle}${rng.int(1, 99)}`;
      used.add(handle);
      const city = rng.pick(CITIES[p.region]);
      const gym = rng.pick(GYMS);
      const createdAt = pastMoment(rng, 180, now); // joined over the last ~6 months
      const bio = p.tagline.replace("{gym}", gym).replace("{city}", city);
      rows.push({
        email: `${handle}${SEED_EMAIL_DOMAIN}`,
        name,
        username: handle,
        passwordHash,
        registryRole: p.registryRole,
        role: p.role,
        bio,
        ageConfirmed: true,
        ageConfirmedAt: createdAt,
        createdAt,
      });
      meta.push({ persona: p, name, username: handle, createdAt, gym, city, reputation: 0, resolved: 0, correct: 0, streak: 0, bestStreak: 0 });
    }
  }

  await prisma.user.createMany({ data: rows, skipDuplicates: true });
  const created = await prisma.user.findMany({
    where: { email: { endsWith: SEED_EMAIL_DOMAIN } },
    select: { id: true, email: true },
  });
  const idByHandle = new Map(created.map((u) => [u.email!.replace(SEED_EMAIL_DOMAIN, ""), u.id]));
  return meta.map((m) => ({ ...m, id: idByHandle.get(m.username)! })).filter((u) => u.id);
}

// ── Favourites + promotion follows + community membership ────────────────────
async function buildFollows(rng: Rng, users: SeedUser[]) {
  const fighters = await prisma.fighter.findMany({
    select: { id: true, sport: true }, take: 400, orderBy: { wins: "desc" },
  });
  const bySport = new Map<string, string[]>();
  for (const f of fighters) {
    const k = f.sport as string;
    (bySport.get(k) ?? bySport.set(k, []).get(k)!).push(f.id);
  }
  const events = await prisma.event.findMany({ select: { promotion: true }, take: 300 });
  const promoSlugs = [...new Set(events.map((e) => (e.promotion ? resolvePromotion(e.promotion).slug : null)).filter(Boolean) as string[])];

  const favs: Prisma.FavoriteFighterCreateManyInput[] = [];
  const follows: Prisma.FavoritePromotionCreateManyInput[] = [];
  const members: Prisma.CommunityMemberCreateManyInput[] = [];
  const categories = await prisma.forumCategory.findMany({ select: { id: true, slug: true } });
  const catBySlug = new Map(categories.map((c) => [c.slug, c.id]));

  for (const u of users) {
    // fighters they favourite: from their preferred disciplines
    const pool = u.persona.sports.flatMap((s) => bySport.get(s) ?? []);
    const n = u.persona.collector ? rng.int(4, 9) : rng.int(1, 5);
    for (const fid of rng.sample(pool.length ? pool : fighters.map((f) => f.id), n)) {
      favs.push({ userId: u.id, fighterId: fid, createdAt: pastMoment(rng, 150, Date.now()) });
    }
    // promotions they follow
    for (const slug of rng.sample(promoSlugs, rng.int(1, Math.min(3, promoSlugs.length || 1)))) {
      follows.push({ userId: u.id, promotion: slug, createdAt: pastMoment(rng, 150, Date.now()) });
    }
    // communities they join (by discipline)
    for (const s of u.persona.sports) {
      const cid = catBySlug.get(CATEGORY_FOR_SPORT[s]);
      if (cid) members.push({ communityId: cid, userId: u.id, createdAt: u.createdAt });
    }
  }
  if (favs.length) await prisma.favoriteFighter.createMany({ data: favs, skipDuplicates: true });
  if (follows.length) await prisma.favoritePromotion.createMany({ data: follows, skipDuplicates: true });
  if (members.length) await prisma.communityMember.createMany({ data: members, skipDuplicates: true });
  return { favs: favs.length, follows: follows.length };
}

// ── Fetch the events that anchor picks + discussion ──────────────────────────
type EventWithFights = Prisma.EventGetPayload<{
  include: { fights: { include: { red: true; blue: true } } };
}>;

async function loadEvents(now: Date): Promise<{ upcoming: EventWithFights[]; recent: EventWithFights[] }> {
  const inc = { fights: { include: { red: true, blue: true }, orderBy: { orderOnCard: "asc" as const } } };
  const [upcoming, recent] = await Promise.all([
    prisma.event.findMany({ where: { date: { gte: now } }, include: inc, orderBy: { date: "asc" }, take: 5 }),
    prisma.event.findMany({ where: { date: { lt: now } }, include: inc, orderBy: { date: "desc" }, take: 8 }),
  ]);
  return { upcoming, recent };
}

function winnerCorner(f: EventWithFights["fights"][number]): "RED" | "BLUE" | null {
  if (f.result !== "WIN" || !f.winnerId) return null;
  if (f.winnerId === f.redId || f.winnerId === f.red.slug) return "RED";
  if (f.winnerId === f.blueId || f.winnerId === f.blue.slug) return "BLUE";
  return null;
}

// ── Open picks on upcoming cards (populate the crowd bars) ───────────────────
async function buildOpenPicks(rng: Rng, users: SeedUser[], upcoming: EventWithFights[], now: number) {
  const picks: Prisma.FightPickCreateManyInput[] = [];
  const analytics: Prisma.AnalyticsEventCreateManyInput[] = [];
  for (const ev of upcoming) {
    for (const f of ev.fights) {
      if (f.result !== "SCHEDULED") continue;
      // A pseudo-favourite from records, so styles mean something.
      const favCorner: "RED" | "BLUE" = (f.red.wins ?? 0) >= (f.blue.wins ?? 0) ? "RED" : "BLUE";
      const dogCorner = favCorner === "RED" ? "BLUE" : "RED";
      for (const u of users) {
        const p = u.persona;
        const sportMatch = p.sports.includes(f.red.sport) || p.sports.includes(f.blue.sport);
        if (!rng.chance(activityPickProb(p.activity) * (sportMatch ? 1 : 0.35))) continue;
        let corner: "RED" | "BLUE";
        switch (p.pickStyle) {
          case "underdog": corner = rng.chance(0.8) ? dogCorner : favCorner; break;
          case "contrarian": corner = rng.chance(0.65) ? dogCorner : favCorner; break;
          case "technical": corner = rng.chance(0.35) ? dogCorner : favCorner; break;
          case "homer": corner = rng.pick(["RED", "BLUE"]); break;
          default: corner = rng.chance(0.82) ? favCorner : dogCorner; // favourite / casual
        }
        const createdAt = pastMoment(rng, 12, now);
        picks.push({
          userId: u.id, fightId: f.id, corner, method: methodFor(p, rng),
          confidence: confidenceFor(p, rng), createdAt,
        });
        analytics.push({ name: "prediction_made", userId: u.id, path: `/events/${ev.slug}`, ts: createdAt });
      }
    }
  }
  if (picks.length) await prisma.fightPick.createMany({ data: picks, skipDuplicates: true });
  if (analytics.length) await prisma.analyticsEvent.createMany({ data: analytics });
  return picks.length;
}

// ── Graded history — the reward layer, using the REAL P0-3 reputation math ───
async function buildGradedHistory(rng: Rng, users: SeedUser[], recent: EventWithFights[]) {
  // Pass 1: assign participants + correctness per fight, deriving each fight's
  // upsetFactor (share of the crowd that got it wrong) exactly as resolve.ts does.
  interface Entry {
    u: SeedUser; fight: EventWithFights["fights"][number]; ev: EventWithFights;
    correct: boolean; confidence: number; method: FightMethod;
    winnerCorner: "RED" | "BLUE"; winnerFighterId: string; winnerName: string; loserName: string;
  }
  const entries: Entry[] = [];
  const upsetByFight = new Map<string, number>();

  for (const ev of recent) {
    for (const f of ev.fights) {
      const wc = winnerCorner(f);
      if (!wc) continue; // only decisive WINs earn/grade
      const fightDate = f.date;
      const participants = users.filter((u) => {
        if (u.createdAt >= fightDate) return false; // couldn't have picked before joining
        const sportMatch = u.persona.sports.includes(f.red.sport) || u.persona.sports.includes(f.blue.sport);
        return rng.chance(activityPickProb(u.persona.activity) * 0.5 * (sportMatch ? 1 : 0.3));
      });
      if (!participants.length) continue;
      const winnerFighterId = wc === "RED" ? f.redId : f.blueId;
      const winnerName = wc === "RED" ? f.red.name : f.blue.name;
      const loserName = wc === "RED" ? f.blue.name : f.red.name;
      let wrong = 0;
      for (const u of participants) {
        const correct = rng.chance(u.persona.skill);
        if (!correct) wrong++;
        entries.push({ u, fight: f, ev, correct, confidence: confidenceFor(u.persona, rng), method: methodFor(u.persona, rng), winnerCorner: wc, winnerFighterId, winnerName, loserName });
      }
      upsetByFight.set(f.id, wrong / participants.length);
    }
  }

  // Pass 2: per user, chronological, to build streaks + reputation + the fan-out.
  const picks: Prisma.FightPickCreateManyInput[] = [];
  const reps: Prisma.ReputationEventCreateManyInput[] = [];
  const cards: Prisma.CardAwardCreateManyInput[] = [];
  const notifs: Prisma.NotificationCreateManyInput[] = [];
  const acts: Prisma.ActivityCreateManyInput[] = [];
  const analytics: Prisma.AnalyticsEventCreateManyInput[] = [];

  const byUser = new Map<string, Entry[]>();
  for (const e of entries) (byUser.get(e.u.id) ?? byUser.set(e.u.id, []).get(e.u.id)!).push(e);

  for (const [, list] of byUser) {
    list.sort((a, b) => a.fight.date.getTime() - b.fight.date.getTime());
    const u = list[0].u;
    for (const e of list) {
      const wc = e.winnerCorner;
      const corner = e.correct ? wc : wc === "RED" ? "BLUE" : "RED";
      const pickedAt = new Date(Math.max(u.createdAt.getTime() + 3_600_000, e.fight.date.getTime() - rng.int(1, 4) * 86_400_000));
      const resolvedAt = new Date(e.fight.date.getTime() + rng.int(1, 6) * 3_600_000);
      u.resolved++;
      picks.push({ userId: u.id, fightId: e.fight.id, corner, method: e.method, confidence: e.confidence, correct: e.correct, createdAt: pickedAt });
      analytics.push({ name: "prediction_made", userId: u.id, path: `/events/${e.ev.slug}`, ts: pickedAt });
      const boutUrl = `/events/${e.ev.slug}#predictions`;
      if (e.correct) {
        u.correct++; u.streak++; u.bestStreak = Math.max(u.bestStreak, u.streak);
        const rep = pickReputation({ upsetFactor: upsetByFight.get(e.fight.id) ?? 0.5, confidence: e.confidence, streak: u.streak });
        u.reputation += rep;
        reps.push({ userId: u.id, delta: rep, reason: "pick_correct", refType: "fight", refId: e.fight.id, createdAt: resolvedAt });
        const rarity = rarityForFight(e.fight) as CardRarity;
        cards.push({ userId: u.id, fighterId: e.winnerFighterId, rarity, reason: "correct_pick", fightId: e.fight.id, createdAt: resolvedAt });
        acts.push({ userId: u.id, type: "CARD_EARNED" as ActivityType, title: `Earned a ${rarity.toLowerCase()} ${e.winnerName} card`, url: boutUrl, createdAt: resolvedAt });
        acts.push({ userId: u.id, type: "PICK_CORRECT" as ActivityType, title: `Correctly picked ${e.winnerName}`, url: boutUrl, createdAt: resolvedAt });
        notifs.push({ userId: u.id, type: "PICK_RESULT" as NotificationType, title: `You called it — ${e.winnerName} won`, body: `+${rep} reputation · ${u.streak}-pick streak · ${rarity.toLowerCase()} card earned`, url: boutUrl, icon: "✅", readAt: rng.chance(0.6) ? resolvedAt : null, createdAt: resolvedAt });
      } else {
        u.streak = 0;
        notifs.push({ userId: u.id, type: "PICK_RESULT" as NotificationType, title: `Tough one — ${e.winnerName} took it`, body: `Your pick didn't land — streak reset.`, url: boutUrl, icon: "❌", readAt: rng.chance(0.5) ? resolvedAt : null, createdAt: resolvedAt });
      }
    }
  }

  await prisma.$transaction([
    ...(picks.length ? [prisma.fightPick.createMany({ data: picks, skipDuplicates: true })] : []),
    ...(reps.length ? [prisma.reputationEvent.createMany({ data: reps })] : []),
    ...(cards.length ? [prisma.cardAward.createMany({ data: cards })] : []),
    ...(notifs.length ? [prisma.notification.createMany({ data: notifs, skipDuplicates: true })] : []),
    ...(acts.length ? [prisma.activity.createMany({ data: acts })] : []),
    ...(analytics.length ? [prisma.analyticsEvent.createMany({ data: analytics })] : []),
  ]);

  // Push the denormalised per-user tallies the app reads for O(1) leaderboards.
  for (const u of users) {
    if (!u.resolved) continue;
    await prisma.user.update({
      where: { id: u.id },
      data: { reputation: u.reputation, picksResolved: u.resolved, picksCorrect: u.correct, pickStreak: u.streak, bestPickStreak: u.bestStreak },
    });
  }
  return { graded: picks.length, cards: cards.length };
}

// ── Discussion — threads, nested replies, reactions, spread over days ────────
// Fill an event-comment template from a specific bout.
function fill(t: string, f: EventWithFights["fights"][number] | undefined, rng: Rng, sport: string, gym: string): string {
  if (!f) return t.replace(/\{[^}]+\}/g, "the main event");
  const fav = (f.red.wins ?? 0) >= (f.blue.wins ?? 0) ? f.red.name : f.blue.name;
  const dog = fav === f.red.name ? f.blue.name : f.red.name;
  const wc = winnerCorner(f);
  const winner = wc === "RED" ? f.red.name : wc === "BLUE" ? f.blue.name : fav;
  const loser = winner === f.red.name ? f.blue.name : f.red.name;
  return t
    .replace(/\{red\}/g, f.red.name).replace(/\{blue\}/g, f.blue.name)
    .replace(/\{fav\}/g, fav).replace(/\{dog\}/g, dog)
    .replace(/\{winner\}/g, winner).replace(/\{loser\}/g, loser)
    .replace(/\{method\}/g, rng.pick(["KO", "submission", "decision", "TKO"]))
    .replace(/\{round\}/g, String(rng.int(1, 5)))
    .replace(/\{sport\}/g, sport.toLowerCase().replace("_", " "))
    .replace(/\{gym\}/g, gym).replace(/\{city\}/g, "");
}

// Fill a topic / fighter template (no specific bout).
function fillText(t: string, opts: { sport?: string; gym?: string; subject?: string }): string {
  return t
    .replace(/\{sport\}/g, (opts.sport ?? "combat sports").toLowerCase().replace(/_/g, " "))
    .replace(/\{gym\}/g, opts.gym ?? "the gym")
    .replace(/\{subject\}/g, opts.subject ?? "this fighter")
    .replace(/\{[^}]+\}/g, "");
}

type ContentFor = (author: SeedUser, isReply: boolean, isPostResult: boolean) => string;

// The shared thread populator: nested posts + respect/disrespect reactions,
// timestamps spread from `base` to now, denormalised counters kept honest.
async function seedThread(
  threadId: string, participants: SeedUser[], count: number, now: number, completed: boolean,
  base: Date, contentFor: ContentFor, rng: Rng,
): Promise<{ posts: number; reactions: number }> {
  const roots: string[] = [];
  let replyCount = 0, threadReactions = 0, lastPostAt = base, posts = 0, reactions = 0;
  const span = Math.max(1, now - base.getTime());

  for (let i = 0; i < count; i++) {
    const author = rng.pick(participants);
    const isReply = roots.length > 0 && rng.chance(0.55);
    const isPostResult = completed && rng.chance(0.4);
    const content = contentFor(author, isReply, isPostResult);
    const createdAt = new Date(Math.min(base.getTime() + Math.floor(rng.float() * span), now - rng.int(1, 600) * 60_000));
    if (createdAt.getTime() > lastPostAt.getTime()) lastPostAt = createdAt;

    const post = await prisma.forumPost.create({
      data: { threadId, authorId: author.id, content, parentId: isReply ? rng.pick(roots) : null, createdAt },
      select: { id: true },
    });
    posts++;
    if (!isReply) roots.push(post.id);
    else replyCount++; // app contract: replyCount = replies only (OP + roots excluded)

    // Combat-native reactions using the app's existing types: respect (the
    // fist-bump) dominant, the occasional disrespect. reactionCount = total rows.
    const reactors = rng.sample(participants.filter((u) => u.id !== author.id), rng.int(0, 6));
    if (reactors.length) {
      await prisma.forumReaction.createMany({
        data: reactors.map((u) => ({ postId: post.id, userId: u.id, type: rng.chance(0.85) ? "respect" : "disrespect", createdAt: new Date(createdAt.getTime() + rng.int(1, 240) * 60_000) })),
        skipDuplicates: true,
      });
      threadReactions += reactors.length;
      reactions += reactors.length;
    }
  }

  await prisma.forumThread.update({
    where: { id: threadId },
    data: { replyCount, reactionCount: threadReactions, lastPostAt, views: rng.int(40, 900) },
  });
  return { posts, reactions };
}

// Ensure a slug is unique before creating a thread.
async function uniqueThreadSlug(title: string): Promise<string> {
  const base = slugifyThread(title);
  let slug = base;
  for (let i = 2; await prisma.forumThread.findUnique({ where: { slug }, select: { id: true } }); i++) slug = `${base}-${i}`;
  return slug;
}

// Event threads — reuse the app's if present, else provision one.
async function buildDiscussion(rng: Rng, users: SeedUser[], events: EventWithFights[], now: number) {
  const journalists = users.filter((u) => u.persona.registryRole === "media");
  let threads = 0, posts = 0, reactions = 0;

  for (const ev of events) {
    if (!ev.fights.length) continue;
    const completed = ev.date < new Date(now);
    const catSlug = CATEGORY_FOR_SPORT[ev.sport as string] ?? "general";
    const category = await prisma.forumCategory.findUnique({ where: { slug: catSlug }, select: { id: true } });
    if (!category) continue;
    const base = daysAgo(rng.int(6, 20), now);

    let thread = await prisma.forumThread.findUnique({ where: { eventId: ev.id }, select: { id: true } });
    if (!thread) {
      const author = (journalists.length ? rng.pick(journalists) : rng.pick(users)).id;
      const title = `${ev.name} — discussion`.slice(0, 155);
      const slug = await uniqueThreadSlug(title);
      thread = await prisma.forumThread.create({
        data: {
          slug, title, categoryId: category.id, authorId: author, kind: "discussion", eventId: ev.id,
          createdAt: base, lastPostAt: base,
          posts: { create: { authorId: author, content: `Predictions, live reactions and results for **${ev.name}**. Make your picks, back your read, and see who called it.`, createdAt: base } },
        },
        select: { id: true },
      });
      threads++;
    }

    const participants = rng.sample(users, rng.int(6, Math.min(14, users.length)));
    const contentFor: ContentFor = (author, isReply, isPostResult) => {
      const bank = COMMENT_BANKS[author.persona.tone];
      const raw = isPostResult ? rng.pick(bank.postResult) : isReply ? rng.pick(bank.reply) : rng.pick(bank.opener);
      return fill(raw, rng.pick(ev.fights), rng, ev.sport as string, author.gym);
    };
    const r = await seedThread(thread.id, participants, rng.int(8, 22), now, completed, base, contentFor, rng);
    posts += r.posts; reactions += r.reactions;

    const activityAuthor = journalists.length ? rng.pick(journalists) : rng.pick(users);
    await prisma.activity.create({ data: { userId: activityAuthor.id, type: "THREAD_CREATED" as ActivityType, title: `Started the discussion on ${ev.name}`, url: `/events/${ev.slug}#discussion`, createdAt: base } });
  }
  return { threads, posts, reactions };
}

const SLUG_SPORT: Record<string, string> = {
  mma: "MMA", boxing: "Boxing", "muay-thai": "Muay Thai", kickboxing: "Kickboxing", bjj: "BJJ",
  wrestling: "Wrestling", judo: "Judo", sambo: "Sambo", "bare-knuckle": "Bare Knuckle",
  taekwondo: "Taekwondo", general: "combat sports", industry: "the industry",
};

// Topic threads in every forum category — so /forums and each discipline board
// is alive even with no event on the calendar.
async function buildTopicThreads(rng: Rng, users: SeedUser[], now: number) {
  let threads = 0, posts = 0, reactions = 0;
  const categories = await prisma.forumCategory.findMany({ select: { id: true, slug: true, name: true } });
  for (const cat of categories) {
    const sportLabel = SLUG_SPORT[cat.slug] ?? cat.name;
    const relevant = users.filter((u) => u.persona.sports.some((s) => CATEGORY_FOR_SPORT[s] === cat.slug));
    const pool = relevant.length >= 4 ? relevant : users;
    const nThreads = cat.slug === "general" ? 3 : 2;
    for (let t = 0; t < nThreads; t++) {
      const author = rng.pick(pool);
      const title = fillText(rng.pick(TOPIC_TITLES), { sport: sportLabel }).slice(0, 155);
      const slug = await uniqueThreadSlug(title);
      const base = daysAgo(rng.int(3, 40), now);
      const thread = await prisma.forumThread.create({
        data: {
          slug, title, categoryId: cat.id, authorId: author.id, kind: "discussion", createdAt: base, lastPostAt: base,
          posts: { create: { authorId: author.id, content: fillText(rng.pick(TOPIC_BANK.opener), { sport: sportLabel, gym: author.gym }), createdAt: base } },
        },
        select: { id: true },
      });
      threads++;
      const participants = rng.sample(pool, rng.int(5, Math.min(12, pool.length)));
      const contentFor: ContentFor = (a, isReply) => fillText(isReply ? rng.pick(TOPIC_BANK.reply) : rng.pick(TOPIC_BANK.opener), { sport: sportLabel, gym: a.gym });
      const r = await seedThread(thread.id, participants, rng.int(6, 16), now, false, base, contentFor, rng);
      posts += r.posts; reactions += r.reactions;
    }
  }
  return { threads, posts, reactions };
}

// A discussion thread on popular fighters' pages.
async function buildFighterThreads(rng: Rng, users: SeedUser[], now: number) {
  let threads = 0, posts = 0, reactions = 0;
  const fighters = await prisma.fighter.findMany({ select: { id: true, name: true, sport: true }, orderBy: { wins: "desc" }, take: 24 });
  for (const f of fighters) {
    const catSlug = CATEGORY_FOR_SPORT[f.sport as string] ?? "general";
    const category = await prisma.forumCategory.findUnique({ where: { slug: catSlug }, select: { id: true } });
    if (!category) continue;
    const relevant = users.filter((u) => u.persona.sports.includes(f.sport));
    const pool = relevant.length >= 4 ? relevant : users;
    const author = rng.pick(pool);
    const title = `${f.name} — discussion`.slice(0, 155);
    const slug = await uniqueThreadSlug(title);
    const base = daysAgo(rng.int(3, 40), now);
    const sportLabel = (f.sport as string).toLowerCase().replace(/_/g, " ");
    // fighterId is unique — if a thread already exists, skip gracefully.
    const thread = await prisma.forumThread.create({
      data: {
        slug, title, categoryId: category.id, authorId: author.id, kind: "discussion", fighterId: f.id, createdAt: base, lastPostAt: base,
        posts: { create: { authorId: author.id, content: fillText(rng.pick(FIGHTER_BANK.opener), { subject: f.name, sport: sportLabel, gym: author.gym }), createdAt: base } },
      },
      select: { id: true },
    }).catch(() => null);
    if (!thread) continue;
    threads++;
    const participants = rng.sample(pool, rng.int(4, Math.min(10, pool.length)));
    const contentFor: ContentFor = (a, isReply) => fillText(isReply ? rng.pick(FIGHTER_BANK.reply) : rng.pick(FIGHTER_BANK.opener), { subject: f.name, sport: sportLabel, gym: a.gym });
    const r = await seedThread(thread.id, participants, rng.int(4, 12), now, false, base, contentFor, rng);
    posts += r.posts; reactions += r.reactions;
  }
  return { threads, posts, reactions };
}

// A discussion thread per promotion.
async function buildPromotionThreads(rng: Rng, users: SeedUser[], now: number) {
  let threads = 0, posts = 0, reactions = 0;
  const events = await prisma.event.findMany({ select: { promotion: true, sport: true }, take: 200 });
  const promos = new Map<string, { slug: string; label: string; sport: string }>();
  for (const e of events) {
    if (!e.promotion) continue;
    const slug = resolvePromotion(e.promotion).slug;
    if (!promos.has(slug)) promos.set(slug, { slug, label: e.promotion, sport: e.sport as string });
  }
  for (const p of [...promos.values()].slice(0, 6)) {
    const catSlug = CATEGORY_FOR_SPORT[p.sport] ?? "general";
    const category = await prisma.forumCategory.findUnique({ where: { slug: catSlug }, select: { id: true } });
    if (!category) continue;
    const author = rng.pick(users);
    const title = `${p.label} — promotion talk`.slice(0, 155);
    const slug = await uniqueThreadSlug(title);
    const base = daysAgo(rng.int(3, 40), now);
    const sportLabel = p.sport.toLowerCase().replace(/_/g, " ");
    const thread = await prisma.forumThread.create({
      data: {
        slug, title, categoryId: category.id, authorId: author.id, kind: "discussion", promotion: p.slug, createdAt: base, lastPostAt: base,
        posts: { create: { authorId: author.id, content: fillText(rng.pick(TOPIC_BANK.opener), { sport: sportLabel, gym: author.gym }), createdAt: base } },
      },
      select: { id: true },
    }).catch(() => null);
    if (!thread) continue;
    threads++;
    const participants = rng.sample(users, rng.int(5, Math.min(12, users.length)));
    const contentFor: ContentFor = (a, isReply) => fillText(isReply ? rng.pick(TOPIC_BANK.reply) : rng.pick(TOPIC_BANK.opener), { sport: sportLabel, gym: a.gym });
    const r = await seedThread(thread.id, participants, rng.int(6, 14), now, false, base, contentFor, rng);
    posts += r.posts; reactions += r.reactions;
  }
  return { threads, posts, reactions };
}

// ── Ambient signals: announcements, follows-activity, pageviews ──────────────
async function buildAmbient(rng: Rng, users: SeedUser[], upcoming: EventWithFights[], now: number) {
  const notifs: Prisma.NotificationCreateManyInput[] = [];
  const acts: Prisma.ActivityCreateManyInput[] = [];
  const analytics: Prisma.AnalyticsEventCreateManyInput[] = [];

  for (const u of users) {
    // Fight-week announcements for the next card in a discipline they follow.
    for (const ev of upcoming.slice(0, 2)) {
      if (rng.chance(0.5)) {
        notifs.push({ userId: u.id, type: "FIGHT_ANNOUNCED" as NotificationType, title: `${ev.name} is almost here`, body: "Make your picks before the first bell.", url: `/events/${ev.slug}`, icon: "🔔", dedupeKey: `seed_soon:${ev.id}`, readAt: rng.chance(0.4) ? new Date() : null, createdAt: pastMoment(rng, 3, now) });
      }
    }
    // Reputation milestone flavour for the higher-rep users.
    if (u.reputation >= 60 && rng.chance(0.7)) {
      notifs.push({ userId: u.id, type: "REP_MILESTONE" as NotificationType, title: `You crossed ${Math.floor(u.reputation / 20) * 20} reputation`, body: "Your read is trusted — keep calling them.", url: "/leaderboard", icon: "⭐", createdAt: pastMoment(rng, 20, now) });
    }
    // Pageview + engagement analytics spread across their active life (drives
    // WAU/DAU/retention on the admin dashboard).
    const views = u.persona.activity === "whale" ? rng.int(18, 45) : u.persona.activity === "regular" ? rng.int(6, 22) : rng.int(2, 8);
    for (let i = 0; i < views; i++) {
      const ts = new Date(Math.max(u.createdAt.getTime(), now - rng.int(0, 30) * 86_400_000 - rng.int(0, 86_400_000)));
      analytics.push({ name: "pageview", userId: u.id, path: rng.pick(["/", "/events", "/leaderboard", "/collection", `/profile`]), ts });
    }
    if (rng.chance(0.5)) analytics.push({ name: "notification_open", userId: u.id, ts: pastMoment(rng, 10, now) });
    if (rng.chance(0.6)) analytics.push({ name: "follow_fighter", userId: u.id, ts: pastMoment(rng, 60, now) });
    analytics.push({ name: "signup", userId: u.id, ts: u.createdAt });
  }
  if (notifs.length) await prisma.notification.createMany({ data: notifs, skipDuplicates: true });
  if (acts.length) await prisma.activity.createMany({ data: acts });
  if (analytics.length) await prisma.analyticsEvent.createMany({ data: analytics });
}

// ════════════════════════════════════════════════════════════════════════════
//  Orchestrator
// ════════════════════════════════════════════════════════════════════════════
export async function generateWorld(): Promise<Record<string, number>> {
  const rng = new Rng();
  const now = Date.now();

  await ensureCategories();
  const users = await buildUsers(rng, now);
  const follows = await buildFollows(rng, users);
  const { upcoming, recent } = await loadEvents(new Date(now));
  const eventCount = upcoming.length + recent.length;

  const openPicks = await buildOpenPicks(rng, users, upcoming, now);
  const graded = await buildGradedHistory(rng, users, recent);

  // Populate every discussion surface — event, category, fighter and promotion
  // threads — so a tester never lands on an empty conversation.
  const evT = await buildDiscussion(rng, users, [...upcoming, ...recent], now);
  const topicT = await buildTopicThreads(rng, users, now);
  const fighterT = await buildFighterThreads(rng, users, now);
  const promoT = await buildPromotionThreads(rng, users, now);
  await buildAmbient(rng, users, upcoming, now);

  return {
    users: users.length,
    events: eventCount,
    favourites: follows.favs,
    promotionFollows: follows.follows,
    openPicks,
    gradedPicks: graded.graded,
    cards: graded.cards,
    threads: evT.threads + topicT.threads + fighterT.threads + promoT.threads,
    posts: evT.posts + topicT.posts + fighterT.posts + promoT.posts,
    reactions: evT.reactions + topicT.reactions + fighterT.reactions + promoT.reactions,
  };
}
