import "server-only";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications-store";
import { promotionBySlug } from "@/lib/promotions";
import { channelById } from "./channels";
import { flog } from "./log";
import type { FeedVideo } from "./types";

// ════════════════════════════════════════════════════════════════════════════
//  "New video from something you follow."
//
//  This is the producer most likely to become spam, so it is the most heavily
//  restrained one in the app:
//
//   • OFFICIAL CHANNELS ONLY. A promotion's own channel can tell its followers
//     it uploaded. A commentary channel cannot — nobody followed "MMA Junkie",
//     they followed UFC, and a third-party reaction video is not an event.
//   • ONE PER RUN PER PERSON. A promotion that drops six videos at once sends
//     one notification about the newest, not six. Fight week is exactly when a
//     channel uploads in bursts and exactly when being noisy is unforgivable.
//   • FOLLOWERS ONLY, never a broadcast — audience comes from FavoritePromotion,
//     the same table the event reminders use.
//   • NOTHING OLDER THAN A DAY. Backfills, re-ingests and a first run against
//     an empty cache must not notify anyone about last month's uploads.
//
//  Everything else — quiet hours, the "fights" category toggle, push delivery,
//  dedupe — comes free from notify(), which is why this file is short.
// ════════════════════════════════════════════════════════════════════════════

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function notifyNewVideos(videos: FeedVideo[]): Promise<number> {
  const now = Date.now();

  // Newest first, so the one video a follower hears about is the latest.
  const candidates = videos
    .map((v) => ({ v, c: channelById(v.channelId) }))
    .filter((x): x is { v: FeedVideo; c: NonNullable<ReturnType<typeof channelById>> } => !!x.c?.promotion)
    .filter((x) => {
      const at = x.v.publishedAt ? new Date(x.v.publishedAt).getTime() : 0;
      return at > 0 && now - at < MAX_AGE_MS;
    })
    .sort((a, b) => new Date(b.v.publishedAt).getTime() - new Date(a.v.publishedAt).getTime());

  if (!candidates.length) return 0;

  // One winner per promotion — the newest thing it published this run.
  const newestByPromotion = new Map<string, FeedVideo>();
  for (const { v, c } of candidates) {
    if (!newestByPromotion.has(c.promotion!)) newestByPromotion.set(c.promotion!, v);
  }

  let sent = 0;
  for (const [promotion, video] of newestByPromotion) {
    try {
      const followers = await prisma.favoritePromotion.findMany({
        where: { promotion },
        select: { userId: true },
      });
      if (!followers.length) continue;

      // by SLUG: resolvePromotion() matches free-text aliases, so a slug like
      // "one" fell through to its unknown-promotion branch and titled the
      // notification "one posted a new video".
      const name = promotionBySlug(promotion)?.name ?? promotion.toUpperCase();
      await Promise.all(
        followers.map((f) =>
          notify(prisma, f.userId, {
            type: "FIGHT_ANNOUNCED", // the "fights" push category — what a follower opted into
            title: `${name} posted a new video`,
            body: video.title.slice(0, 140),
            url: `/clips?promotion=${promotion}`,
            icon: "▶️",
            // Per VIDEO, so a re-ingest cannot re-notify, and per user via the
            // (userId, dedupeKey) unique.
            dedupeKey: `video:${video.id}`,
            // One promotion = one lit phone, however many videos it posts.
            tag: `video:${promotion}`,
          }),
        ),
      );
      sent += followers.length;
    } catch (e) {
      flog.error({ op: "feed.notify", promotion, err: (e as Error).message }, "video notify failed");
    }
  }
  return sent;
}
