import "server-only";
import { prisma } from "@/lib/db";

// ── Launch metrics ──────────────────────────────────────────────────────────
// The innovation-accounting readout for the Phase-1 gate: "do users come back
// for the next fight?" WAPU is the north star. Retention cohorts populate as the
// (new) analytics table accrues history — they read 0 until data exists, which
// is correct, not broken.

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

async function distinctUsers(name: string, sinceDays: number): Promise<number> {
  const rows = await prisma.analyticsEvent.findMany({
    where: { name, userId: { not: null }, ts: { gte: ago(sinceDays) } },
    select: { userId: true },
    distinct: ["userId"],
  });
  return rows.length;
}

/**
 * Registered-user retention: of users who signed up in a 7-day cohort ending
 * `horizon` days ago, what share returned (any tracked event) on/after
 * signup + horizon. Per-user threshold checked in memory (launch-scale cohorts).
 */
async function retention(horizonDays: number): Promise<{ cohort: number; returned: number; pct: number } | null> {
  const end = ago(horizonDays);
  const start = new Date(end.getTime() - 7 * DAY);
  const cohort = await prisma.user.findMany({
    where: { createdAt: { gte: start, lt: end } },
    select: { id: true, createdAt: true },
  });
  if (!cohort.length) return null;
  const ids = cohort.map((u) => u.id);
  const events = await prisma.analyticsEvent.findMany({
    where: { userId: { in: ids }, ts: { gte: new Date(start.getTime() + horizonDays * DAY) } },
    select: { userId: true, ts: true },
    take: 20_000,
  });
  const returned = cohort.filter((u) =>
    events.some((e) => e.userId === u.id && e.ts.getTime() >= u.createdAt.getTime() + horizonDays * DAY),
  ).length;
  return { cohort: cohort.length, returned, pct: Math.round((returned / cohort.length) * 100) };
}

export interface LaunchMetrics {
  wapu: number; // north star — distinct users who made a pick in 7d
  wau: number; // distinct signed-in users active in 7d
  dau: number; // distinct signed-in users active in 24h
  predictionRate: number; // % of weekly-active users who predicted
  retentionD1: { cohort: number; returned: number; pct: number } | null;
  retentionD7: { cohort: number; returned: number; pct: number } | null;
  retentionD30: { cohort: number; returned: number; pct: number } | null;
  pageviews7d: number;
  predictionsMade7d: number;
  follows7d: number;
  notificationOpens7d: number;
  // Cumulative product state
  users: number;
  activePredictors: number; // ever made a resolved pick
  picksTotal: number;
  overallAccuracy: number;
  cardsAwarded: number;
  upcomingEvents: number;
}

export async function getLaunchMetrics(): Promise<LaunchMetrics> {
  const week = ago(7);
  const [
    wapuRows, wau, dau, pageviews7d, predictionsMade7d, followFighter7d, followPromo7d, notificationOpens7d,
    users, picksTotal, cardsAwarded, upcomingEvents, accAgg, activePredictors,
    rD1, rD7, rD30,
  ] = await Promise.all([
    prisma.fightPick.findMany({ where: { updatedAt: { gte: week } }, select: { userId: true }, distinct: ["userId"] }),
    distinctUsers("pageview", 7),
    distinctUsers("pageview", 1),
    prisma.analyticsEvent.count({ where: { name: "pageview", ts: { gte: week } } }),
    prisma.analyticsEvent.count({ where: { name: "prediction_made", ts: { gte: week } } }),
    prisma.analyticsEvent.count({ where: { name: "follow_fighter", ts: { gte: week } } }),
    prisma.analyticsEvent.count({ where: { name: "follow_promotion", ts: { gte: week } } }),
    prisma.analyticsEvent.count({ where: { name: "notification_open", ts: { gte: week } } }),
    prisma.user.count(),
    prisma.fightPick.count(),
    prisma.cardAward.count(),
    prisma.event.count({ where: { date: { gte: new Date() } } }),
    prisma.user.aggregate({ _sum: { picksResolved: true, picksCorrect: true } }),
    prisma.user.count({ where: { picksResolved: { gt: 0 } } }),
    retention(1), retention(7), retention(30),
  ]);

  const wapu = wapuRows.length;
  const resolved = accAgg._sum.picksResolved ?? 0;
  const correct = accAgg._sum.picksCorrect ?? 0;

  return {
    wapu,
    wau,
    dau,
    predictionRate: wau ? Math.round((wapu / wau) * 100) : 0,
    retentionD1: rD1, retentionD7: rD7, retentionD30: rD30,
    pageviews7d,
    predictionsMade7d,
    follows7d: followFighter7d + followPromo7d,
    notificationOpens7d,
    users,
    activePredictors,
    picksTotal,
    overallAccuracy: resolved ? Math.round((correct / resolved) * 100) : 0,
    cardsAwarded,
    upcomingEvents,
  };
}
