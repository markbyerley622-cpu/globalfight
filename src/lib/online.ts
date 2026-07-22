import "server-only";
import { prisma } from "@/lib/db";
import { cached } from "@/lib/cache";

// ════════════════════════════════════════════════════════════════════════════
//  "N online" — derived, not tracked.
//
//  No new table, no heartbeat endpoint, no websocket. The app ALREADY writes a
//  first-party `pageview` AnalyticsEvent on every route change, carrying userId
//  when signed in and a timestamp always, and the table is already indexed on
//  [name, ts]. Anyone who has moved in the last few minutes is online.
//
//  A dedicated presence table would add a write on every navigation to record
//  something we can already read — and would then need its own expiry sweep.
//
//  The count is CACHED briefly and shared: without that, one query per viewer
//  per poll turns a status badge into a load generator. Every viewer inside the
//  window sees the same number from one query, which is also more honest — a
//  per-viewer count would flicker between adjacent reads.
// ════════════════════════════════════════════════════════════════════════════

/** How recently someone must have moved to count as online. */
const WINDOW_MINUTES = 5;

/** Shared cache TTL. Shorter than the client's poll so the number still moves. */
const CACHE_SECONDS = 30;

export interface OnlineCount {
  /** Signed-in people active in the window. */
  members: number;
  /** Members + anonymous sessions. Anonymous rows carry no identity, so this is
   *  an event-derived approximation and is labelled as "people", not "users". */
  total: number;
  windowMinutes: number;
}

export async function getOnlineCount(): Promise<OnlineCount> {
  return cached("online:count", CACHE_SECONDS, async () => {
    const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);

    const [members, anonEvents] = await Promise.all([
      // Distinct signed-in people. groupBy is the only way to get DISTINCT
      // userId through Prisma without raw SQL.
      prisma.analyticsEvent
        .groupBy({
          by: ["userId"],
          where: { name: "pageview", ts: { gte: since }, userId: { not: null } },
        })
        .then((rows) => rows.length)
        .catch(() => 0),
      // Anonymous pageviews carry no cross-session id by design (see
      // analytics.ts), so they cannot be de-duplicated into people. Divided by
      // a rough pages-per-visit factor rather than counted raw, which would
      // otherwise report one browser as a crowd.
      prisma.analyticsEvent
        .count({ where: { name: "pageview", ts: { gte: since }, userId: null } })
        .catch(() => 0),
    ]);

    const anonPeople = Math.round(anonEvents / 4);
    return { members, total: members + anonPeople, windowMinutes: WINDOW_MINUTES };
  });
}
