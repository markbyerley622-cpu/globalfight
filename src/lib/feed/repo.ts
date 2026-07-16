// Postgres persistence for the Combat Feed (via Prisma). Mirrors the repo-wide
// pattern: when USE_MOCK_DATA is on (or the DB errors) these are no-ops / empty,
// so the in-memory + JSON path keeps the feed working with zero infrastructure.
import { prisma, USE_MOCK_DATA } from "@/lib/db";
import { flog } from "./log";
import type { FeedVideo, FeedTopic } from "./types";
import type { UserState } from "./users";

export const dbEnabled = (): boolean => !USE_MOCK_DATA;

// ---- catalog ----
export async function dbHydrateCatalog(max = 8000): Promise<FeedVideo[]> {
  if (USE_MOCK_DATA) return [];
  try {
    const rows = await prisma.feedVideo.findMany({ orderBy: { addedAt: "desc" }, take: max });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      channel: r.channel,
      channelId: r.channelId ?? undefined,
      description: r.description ?? undefined,
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : "",
      viewCount: r.viewCount ?? undefined,
      topic: (r.topic as FeedTopic | null) ?? null,
      tags: r.tags,
      addedAt: r.addedAt.getTime(),
    }));
  } catch (e) {
    flog.error({ op: "db.hydrateCatalog", err: (e as Error).message }, "hydrate catalog failed");
    return [];
  }
}

export function dbPersistVideos(videos: FeedVideo[], now: number): void {
  if (USE_MOCK_DATA || !videos.length) return;
  void prisma.feedVideo
    .createMany({
      data: videos.map((v) => ({
        id: v.id, title: v.title, channel: v.channel, channelId: v.channelId ?? null,
        description: v.description ?? null,
        publishedAt: v.publishedAt ? new Date(v.publishedAt) : null,
        viewCount: v.viewCount ?? null, topic: v.topic ?? null, tags: v.tags ?? [],
        addedAt: new Date(now),
      })),
      skipDuplicates: true,
    })
    .catch((e: Error) => flog.error({ op: "db.persistVideos", err: e.message }, "persist videos failed"));
}

// ---- per-user state ----
export async function dbHydrateUser(key: string): Promise<Partial<UserState>> {
  if (USE_MOCK_DATA) return {};
  try {
    const [views, hidden, ni, interests] = await Promise.all([
      prisma.feedView.findMany({ where: { key }, select: { videoId: true, servedAt: true } }),
      prisma.feedHiddenChannel.findMany({ where: { key }, select: { channelId: true } }),
      prisma.feedNotInterested.findMany({ where: { key }, select: { videoId: true } }),
      prisma.feedInterest.findMany({ where: { key }, select: { tag: true, weight: true } }),
    ]);
    return {
      served: new Map(views.map((v) => [v.videoId, v.servedAt.getTime()])),
      hidden: new Set(hidden.map((h) => h.channelId)),
      notInterested: new Set(ni.map((n) => n.videoId)),
      weights: Object.fromEntries(interests.map((i) => [i.tag, i.weight])),
    };
  } catch (e) {
    flog.error({ op: "db.hydrateUser", err: (e as Error).message }, "hydrate user failed");
    return {};
  }
}

export function dbPersistServed(key: string, ids: string[], now: number): void {
  if (USE_MOCK_DATA || !ids.length) return;
  const at = new Date(now);
  for (const videoId of ids) {
    void prisma.feedView
      .upsert({ where: { key_videoId: { key, videoId } }, create: { key, videoId, servedAt: at }, update: { servedAt: at } })
      .catch(() => {});
  }
}
export function dbPersistHidden(key: string, channelId: string): void {
  if (USE_MOCK_DATA) return;
  void prisma.feedHiddenChannel.createMany({ data: [{ key, channelId }], skipDuplicates: true }).catch(() => {});
}
export function dbPersistNotInterested(key: string, videoId: string): void {
  if (USE_MOCK_DATA) return;
  void prisma.feedNotInterested.createMany({ data: [{ key, videoId }], skipDuplicates: true }).catch(() => {});
}
export function dbPersistInterest(key: string, tag: string, amount: number): void {
  if (USE_MOCK_DATA) return;
  void prisma.feedInterest
    .upsert({ where: { key_tag: { key, tag } }, create: { key, tag, weight: amount }, update: { weight: { increment: amount } } })
    .catch(() => {});
}
