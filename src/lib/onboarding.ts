import "server-only";
import { prisma } from "@/lib/db";
import { SPORTS } from "@/lib/sports";
import { resolvePromotion, promotionBySlug, promotionSearchTerms } from "@/lib/promotions";
import { ROLES, SPORT_MAX } from "@/lib/onboarding-options";

// ════════════════════════════════════════════════════════════════════════════
//  First run.
//
//  The job is not to collect preferences — it is to make sure the user's SECOND
//  session has something in it. Every answer becomes a follow, and the last step
//  auto-follows the upcoming cards those choices imply, so the flow ends on a
//  populated Following feed instead of an empty one.
//
//  It writes through the same tables the Follow buttons use. There is no
//  onboarding-specific storage and no wizard framework.
// ════════════════════════════════════════════════════════════════════════════

const ROLE_VALUES = new Set<string>(ROLES.map((r) => r.value));
const SPORT_VALUES = new Set<string>(SPORTS.map((s) => s.value));

export interface OnboardingPatch {
  role?: string;
  sports?: string[];
  promotions?: string[];
  fighters?: string[];
}

/**
 * Persist whatever the user has chosen so far. Called on every step, so a user
 * who abandons halfway keeps their answers and is never asked twice.
 *
 * Follows are REPLACED, not merged, for the categories present in the patch:
 * the step's UI shows the current selection, so unticking something must
 * actually unfollow it. Categories absent from the patch are left alone.
 */
export async function saveOnboarding(userId: string, patch: OnboardingPatch): Promise<void> {
  const data: { registryRole?: string; sportPrefs?: string[] } = {};

  if (patch.role && ROLE_VALUES.has(patch.role)) data.registryRole = patch.role;
  if (patch.sports) {
    data.sportPrefs = patch.sports.filter((s) => SPORT_VALUES.has(s)).slice(0, SPORT_MAX);
  }
  if (Object.keys(data).length) await prisma.user.update({ where: { id: userId }, data });

  if (patch.promotions) {
    // These arrive as registry SLUGS (the options endpoint emits slugs), so they
    // are validated by exact lookup. Running them back through resolvePromotion
    // alias-matches free text and silently drops orgs whose slug is not itself
    // an alias — "one" resolved to the generic fallback and was discarded.
    const slugs = [...new Set(patch.promotions.map((p) => promotionBySlug(p)?.slug).filter((s): s is string => !!s))];
    await prisma.$transaction([
      slugs.length
        ? prisma.favoritePromotion.deleteMany({ where: { userId, promotion: { notIn: slugs } } })
        : prisma.favoritePromotion.deleteMany({ where: { userId } }),
      prisma.favoritePromotion.createMany({
        data: slugs.map((promotion) => ({ userId, promotion })),
        skipDuplicates: true,
      }),
    ]);
  }

  if (patch.fighters) {
    const ids = [...new Set(patch.fighters)];
    await prisma.$transaction([
      ids.length
        ? prisma.favoriteFighter.deleteMany({ where: { userId, fighterId: { notIn: ids } } })
        : prisma.favoriteFighter.deleteMany({ where: { userId } }),
      prisma.favoriteFighter.createMany({
        data: ids.map((fighterId) => ({ userId, fighterId })),
        skipDuplicates: true,
      }),
    ]);
  }
}

/**
 * Finish (or skip) the flow.
 *
 * The important half is the auto-follow: a user who picked promotions and
 * fighters still has an EMPTY Following feed until something is actually
 * scheduled, so this follows the next cards their choices imply. Without it the
 * flow would end on the exact empty screen it exists to prevent.
 *
 * Idempotent — running it twice follows nothing new and does not move the stamp.
 */
export async function completeOnboarding(userId: string): Promise<{ eventsFollowed: number }> {
  const [promotions, fighters, user] = await Promise.all([
    prisma.favoritePromotion.findMany({ where: { userId }, select: { promotion: true } }),
    prisma.favoriteFighter.findMany({ where: { userId }, select: { fighterId: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { onboardedAt: true, sportPrefs: true } }),
  ]);

  const promotionSlugs = promotions.map((p) => p.promotion);
  const fighterIds = fighters.map((f) => f.fighterId);
  const now = new Date();
  const horizon = new Date(now.getTime() + 60 * 86_400_000);

  let eventsFollowed = 0;
  if (promotionSlugs.length || fighterIds.length || user?.sportPrefs.length) {
    const events = await prisma.event.findMany({
      where: {
        date: { gte: now, lte: horizon },
        OR: [
          // Event.promotion is FREE TEXT ("ONE Friday Fights 163"); a follow is a
          // registry slug ("one"). Matching them directly found nothing, so the
          // flow ended on the empty feed it exists to prevent.
          ...promotionSearchTerms(promotionSlugs).map((t) => ({ promotion: { contains: t, mode: "insensitive" as const } })),
          ...(fighterIds.length
            ? [{ fights: { some: { OR: [{ redId: { in: fighterIds } }, { blueId: { in: fighterIds } }] } } }]
            : []),
        ],
      },
      orderBy: { date: "asc" },
      take: 12,
      select: { id: true },
    });
    if (events.length) {
      const res = await prisma.favoriteEvent.createMany({
        data: events.map((e) => ({ userId, eventId: e.id })),
        skipDuplicates: true,
      });
      eventsFollowed = res.count;
    }
  }

  // Stamp once. Re-running must not reset the date a user first got here.
  if (!user?.onboardedAt) {
    await prisma.user.update({ where: { id: userId }, data: { onboardedAt: now } });
  }
  return { eventsFollowed };
}

/** The current selection, so the flow can be re-entered and edited later. */
export async function getOnboardingState(userId: string) {
  const [user, promotions, fighters] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { registryRole: true, sportPrefs: true, onboardedAt: true } }),
    prisma.favoritePromotion.findMany({ where: { userId }, select: { promotion: true } }),
    prisma.favoriteFighter.findMany({ where: { userId }, select: { fighterId: true } }),
  ]);
  return {
    role: user?.registryRole ?? "fan",
    sports: user?.sportPrefs ?? [],
    promotions: promotions.map((p) => p.promotion),
    fighters: fighters.map((f) => f.fighterId),
    done: !!user?.onboardedAt,
  };
}

/**
 * The choices offered at each step, derived from REAL upcoming data so we never
 * suggest a promotion with no cards or a fighter with no booking.
 */
export async function getOnboardingOptions(sports: string[]) {
  const now = new Date();
  const horizon = new Date(now.getTime() + 120 * 86_400_000);
  const sportFilter = sports.length ? { sport: { in: sports as never[] } } : {};

  const [events, fights] = await Promise.all([
    prisma.event.findMany({
      where: { date: { gte: now, lte: horizon }, promotion: { not: null }, ...sportFilter },
      select: { promotion: true },
      take: 400,
    }),
    prisma.fight.findMany({
      where: { date: { gte: now, lte: horizon }, event: { isNot: null } },
      orderBy: [{ titleFight: "desc" }, { mainEvent: "desc" }, { date: "asc" }],
      take: 120,
      select: {
        red: { select: { id: true, slug: true, name: true, sport: true, countryCode: true, wins: true, losses: true, draws: true, thumbUrl: true, imageUrl: true } },
        blue: { select: { id: true, slug: true, name: true, sport: true, countryCode: true, wins: true, losses: true, draws: true, thumbUrl: true, imageUrl: true } },
      },
    }),
  ]);

  // Promotions ranked by how many cards they actually have coming up. The
  // resolved display name is carried through rather than re-derived from the
  // slug: resolvePromotion matches free text by alias, and several slugs ("one")
  // are deliberately NOT aliases, so a round trip would name them "one".
  const counts = new Map<string, { name: string; upcoming: number }>();
  for (const e of events) {
    if (!e.promotion) continue;
    const p = resolvePromotion(e.promotion);
    if (p.slug === "combat") continue;
    const cur = counts.get(p.slug);
    if (cur) cur.upcoming += 1;
    else counts.set(p.slug, { name: p.name, upcoming: 1 });
  }
  const promotions = [...counts.entries()]
    .sort((a, b) => b[1].upcoming - a[1].upcoming)
    .slice(0, 12)
    .map(([slug, v]) => ({ slug, name: v.name, upcoming: v.upcoming }));

  // Fighters booked on those cards, deduped, biased to the sports they picked.
  const seen = new Set<string>();
  const pool: { id: string; slug: string; name: string; sport: string; countryCode: string | null; record: string; image: string | null }[] = [];
  for (const f of fights) {
    for (const c of [f.red, f.blue]) {
      if (seen.has(c.id)) continue;
      if (sports.length && !sports.includes(c.sport)) continue;
      seen.add(c.id);
      pool.push({
        id: c.id, slug: c.slug, name: c.name, sport: c.sport, countryCode: c.countryCode,
        record: `${c.wins}-${c.losses}${c.draws ? `-${c.draws}` : ""}`,
        image: c.thumbUrl ?? c.imageUrl,
      });
    }
  }

  return { promotions, fighters: pool.slice(0, 24) };
}
