import "server-only";
import { prisma } from "@/lib/db";
import { promotionBySlug } from "@/lib/promotions";
import { SPORTS } from "@/lib/sports";
import type { Prisma } from "@prisma/client";

// ════════════════════════════════════════════════════════════════════════════
//  Contextual video recommendation — ONE helper, every surface.
//
//  The fighter page, the event page, an article, search and the home rails all
//  want the same thing: "videos relevant to THIS". Six surfaces each writing
//  their own FeedVideo query is six places for the taxonomy to be applied
//  slightly differently and six places to forget the mute list. So they all
//  call this, describing their context, and get back cards that already know
//  why they were chosen.
//
//  EVERY RESULT CARRIES A REASON. A video that matches nothing explainable is
//  dropped rather than shown — "no explanation, no recommendation" is the rule
//  that keeps this a recommendation engine instead of a filler engine.
//
//  ONE QUERY per call regardless of how much context is passed: the match terms
//  are OR'd into a single indexed read, never one query per fighter.
// ════════════════════════════════════════════════════════════════════════════

export interface VideoContext {
  /** Full fighter names. An interview naming one of these is the strongest signal. */
  fighterNames?: string[];
  /** Promotion slug(s) from lib/promotions. */
  promotions?: string[];
  /** Discipline slug(s) matching SPORT_PILLS. */
  disciplines?: string[];
  /** Free text (a search query, an article headline) matched against titles. */
  text?: string;
  /** Only videos published inside this window — how an event page avoids
   *  recommending last year's Embedded for next week's card. */
  publishedAfter?: Date;
  publishedBefore?: Date;
  /** Applies this viewer's mute lists. Omit for signed-out surfaces. */
  viewerId?: string | null;
  /** Sink already-served videos below unseen ones instead of dropping them —
   *  what the Following feed wants, where a video you skipped is still a
   *  reasonable thing to meet again, just not at the top. */
  preferUnseen?: boolean;
  /** Copy register. The Following feed speaks in the second person about the
   *  user's own follows ("Following UFC"); contextual rails describe the page
   *  they sit on ("Related to UFC"). Same rules, same query, different voice —
   *  which is cheaper than a second selector that drifts. */
  voice?: "related" | "following";
  limit?: number;
}

export interface VideoRec {
  id: string;
  title: string;
  channel: string;
  publishedAt: string | null;
  promotion: string | null;
  promotionName: string | null;
  /** Why this is on screen. Never null — a rec without one is not returned. */
  reason: string;
}

// A name has to be long enough that `contains` means something. "Jon" appears
// in "Jonathan", "Jones" appears everywhere; the article coverage query already
// refuses short terms for exactly this reason.
const MIN_NAME = 6;

/** Editorial shapes, best first. Used only to ORDER within a tier — never to
 *  exclude, because a channel that doesn't use these words still publishes. */
const SHAPE_RANK: { re: RegExp; label: string }[] = [
  { re: /\binterview\b|\bsits down\b|\bone[- ]on[- ]one\b/i, label: "Interview" },
  { re: /\bmedia day\b|\bscrum\b/i, label: "Media day" },
  { re: /\bembedded\b|\bfight week\b|\bvlog\b/i, label: "Fight week" },
  { re: /\bpress conference\b|\bpresser\b|\bface[- ]?off\b/i, label: "Press conference" },
  { re: /\bweigh[- ]?in/i, label: "Weigh-ins" },
  { re: /\bcountdown\b|\bpreview\b|\bbreakdown\b/i, label: "Preview" },
  { re: /\bhighlight|\bknockout|\bko\b|\bfinish\b/i, label: "Highlights" },
];

const shapeIndex = (title: string): number => {
  const i = SHAPE_RANK.findIndex((s) => s.re.test(title));
  return i === -1 ? SHAPE_RANK.length : i;
};

export async function recommendVideos(ctx: VideoContext): Promise<VideoRec[]> {
  const names = (ctx.fighterNames ?? []).filter((n) => n && n.trim().length >= MIN_NAME);
  const promotions = ctx.promotions?.filter(Boolean) ?? [];
  const disciplines = ctx.disciplines?.filter(Boolean) ?? [];
  const text = (ctx.text ?? "").trim();
  const limit = Math.min(Math.max(ctx.limit ?? 4, 1), 24);

  const or: Prisma.FeedVideoWhereInput[] = [
    ...names.map((n) => ({ title: { contains: n, mode: "insensitive" as const } })),
    ...(promotions.length ? [{ promotion: { in: promotions } }] : []),
    ...(disciplines.length ? [{ discipline: { in: disciplines } }] : []),
    ...(text.length >= 3 ? [{ title: { contains: text, mode: "insensitive" as const } }] : []),
  ];
  if (!or.length) return [];

  // One read. Over-fetch a little so the tiering below has something to choose
  // from, then trim — cheaper than a second query.
  const [rows, muted, mutedChannels, seenRows] = await Promise.all([
    prisma.feedVideo.findMany({
      where: {
        OR: or,
        ...(ctx.publishedAfter || ctx.publishedBefore
          ? {
              publishedAt: {
                ...(ctx.publishedAfter ? { gte: ctx.publishedAfter } : {}),
                ...(ctx.publishedBefore ? { lte: ctx.publishedBefore } : {}),
              },
            }
          : {}),
      },
      orderBy: { publishedAt: "desc" },
      take: Math.max(limit * 4, 24),
      select: {
        id: true, title: true, channel: true, channelId: true,
        publishedAt: true, promotion: true, discipline: true,
      },
    }),
    ctx.viewerId
      ? prisma.feedNotInterested.findMany({ where: { key: ctx.viewerId }, select: { videoId: true } })
      : Promise.resolve([]),
    ctx.viewerId
      ? prisma.feedHiddenChannel.findMany({ where: { key: ctx.viewerId }, select: { channelId: true } })
      : Promise.resolve([]),
    ctx.viewerId && ctx.preferUnseen
      ? prisma.feedView.findMany({ where: { key: ctx.viewerId }, select: { videoId: true } })
      : Promise.resolve([]),
  ]);
  const seen = new Set(seenRows.map((r) => r.videoId));

  const mutedIds = new Set(muted.map((m) => m.videoId));
  const mutedChans = new Set(mutedChannels.map((m) => m.channelId));

  const following = ctx.voice === "following";
  const scored: { rec: VideoRec; tier: number; shape: number; at: number; seen: number }[] = [];
  for (const v of rows) {
    if (mutedIds.has(v.id)) continue;
    if (v.channelId && mutedChans.has(v.channelId)) continue;

    const promoName = v.promotion ? promotionBySlug(v.promotion)?.name ?? null : null;
    const named = names.find((n) => v.title.toLowerCase().includes(n.toLowerCase()));

    // Tiering IS the priority order the product asked for: an exact fighter
    // match beats a promotion match beats a discipline match.
    let tier: number;
    let reason: string;
    if (named) {
      tier = 0;
      reason = following
        ? `Because you follow ${named}`
        : `${SHAPE_RANK[shapeIndex(v.title)]?.label ?? "Featuring"} · ${named}`;
    } else if (v.promotion && promotions.includes(v.promotion)) {
      tier = 1;
      reason = following ? `Following ${promoName ?? v.promotion}` : `Related to ${promoName ?? v.promotion}`;
    } else if (v.discipline && disciplines.includes(v.discipline)) {
      const label = SPORTS.find((s) => s.slug === v.discipline)?.label ?? v.discipline;
      tier = 2;
      reason = following ? `Recommended from ${label}` : `Related to ${label}`;
    } else if (text.length >= 3 && v.title.toLowerCase().includes(text.toLowerCase())) {
      tier = 3;
      reason = `Matches “${text}”`;
    } else {
      continue; // no explanation → no recommendation
    }

    scored.push({
      tier,
      shape: shapeIndex(v.title),
      seen: seen.has(v.id) ? 1 : 0,
      at: v.publishedAt ? v.publishedAt.getTime() : 0,
      rec: {
        id: v.id,
        title: v.title,
        channel: v.channel,
        publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
        promotion: v.promotion,
        promotionName: promoName,
        reason,
      },
    });
  }

  scored.sort((a, b) => a.seen - b.seen || a.tier - b.tier || a.shape - b.shape || b.at - a.at);
  return scored.slice(0, limit).map((s) => s.rec);
}

/** Article.category holds a sport name ("Boxing", "Muay Thai"). Map it to the
 *  discipline slug the video taxonomy uses, so an article's own category is
 *  enough context to recommend from. */
export function disciplineFromCategory(category?: string | null): string | null {
  if (!category) return null;
  const c = category.trim().toLowerCase();
  return SPORTS.find((s) => s.label.toLowerCase() === c || s.slug === c)?.slug ?? null;
}
