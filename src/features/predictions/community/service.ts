// ════════════════════════════════════════════════════════════════════════
//  Community predictions service (DB-backed, fixtures fallback).
//
//  • Reads persist real vote tallies from Postgres.
//  • On first use in an environment with a reachable DB, the table auto-seeds
//    from COMMUNITY_SEEDS (idempotent, keyed on slug).
//  • If the DB is unreachable (e.g. local dev with no DATABASE_URL) reads fall
//    back to the seed content so the page still renders; votes require the DB.
// ════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/db";
import { plog } from "@/features/predictions/logger";
import { COMMUNITY_SEEDS, type CommunitySeed } from "./fixtures";
import type { CommunityMarketView, CommunityOption, CommunityKind, MarketVote } from "./types";
export type { MarketVote };

const log = plog.child({ mod: "community" });

const asOptions = (v: unknown): CommunityOption[] =>
  Array.isArray(v) ? (v as CommunityOption[]) : [];
const asTally = (v: unknown): Record<string, number> =>
  v && typeof v === "object" ? (v as Record<string, number>) : {};

function seedView(s: CommunitySeed): CommunityMarketView {
  return {
    id: `seed:${s.slug}`,
    slug: s.slug,
    kind: s.kind,
    sport: s.sport,
    league: s.league,
    title: s.title,
    subtitle: s.subtitle,
    statusLabel: s.statusLabel,
    description: s.description,
    status: s.status,
    closesAt: s.closesAt,
    options: s.options,
    tally: Object.fromEntries(s.options.map((o) => [o.id, 0])),
    voteCount: 0,
    featured: s.featured,
    hot: s.hot,
    myVote: null,
  };
}

const fixtureViews = (): CommunityMarketView[] => COMMUNITY_SEEDS.map(seedView);

// Skip Postgres entirely when it isn't configured (local dev without a DB) so
// we don't spam prisma connection errors on every request — just serve seeds.
const dbConfigured = (): boolean => Boolean(process.env.DATABASE_URL);

/** Idempotently seed the table from fixtures when it's empty. */
async function ensureSeeded(): Promise<void> {
  const count = await prisma.communityMarket.count();
  if (count > 0) return;
  log.info({ seeds: COMMUNITY_SEEDS.length }, "seeding community markets");
  await prisma.$transaction(
    COMMUNITY_SEEDS.map((s) =>
      prisma.communityMarket.upsert({
        where: { slug: s.slug },
        create: {
          slug: s.slug, seedKey: s.slug, kind: s.kind, sport: s.sport, league: s.league,
          title: s.title, subtitle: s.subtitle, description: s.description, status: s.status,
          closesAt: s.closesAt ? new Date(s.closesAt) : null,
          options: s.options, tally: {}, voteCount: 0, featured: s.featured, hot: s.hot,
        },
        update: {},
      }),
    ),
  );
}

type Row = {
  id: string; slug: string; kind: string; sport: string; league: string | null;
  title: string; subtitle: string | null; statusLabel?: string | null; description: string | null;
  status: string; closesAt: Date | null; options: unknown; tally: unknown; voteCount: number;
  featured: boolean; hot: boolean;
};

function rowView(r: Row, myVote: string | null, seedStatusLabel: string | null): CommunityMarketView {
  return {
    id: r.id, slug: r.slug, kind: r.kind as CommunityKind, sport: r.sport, league: r.league,
    title: r.title, subtitle: r.subtitle,
    // statusLabel isn't a DB column (editorial only) — recover it from the seed.
    statusLabel: seedStatusLabel,
    description: r.description, status: r.status as CommunityMarketView["status"],
    closesAt: r.closesAt ? r.closesAt.toISOString() : null,
    options: asOptions(r.options), tally: asTally(r.tally), voteCount: r.voteCount,
    featured: r.featured, hot: r.hot, myVote,
  };
}

const seedLabelBySlug = new Map(COMMUNITY_SEEDS.map((s) => [s.slug, s.statusLabel]));

/** All community markets, with the signed-in user's votes applied. */
export async function getCommunityMarkets(userId?: string | null): Promise<CommunityMarketView[]> {
  if (!dbConfigured()) return fixtureViews();
  try {
    await ensureSeeded();
    const rows = (await prisma.communityMarket.findMany({
      // Standalone questions only — exclude rows attached to external markets.
      where: { providerMarketId: null },
      orderBy: [{ featured: "desc" }, { voteCount: "desc" }, { createdAt: "asc" }],
    })) as unknown as Row[];
    if (rows.length === 0) return fixtureViews();

    let mine = new Map<string, string>();
    if (userId) {
      const votes = await prisma.communityVote.findMany({
        where: { userId, marketId: { in: rows.map((r) => r.id) } },
        select: { marketId: true, choice: true },
      });
      mine = new Map(votes.map((v) => [v.marketId, v.choice]));
    }
    return rows.map((r) => rowView(r, mine.get(r.id) ?? null, seedLabelBySlug.get(r.slug) ?? null));
  } catch (err) {
    log.warn({ err: String(err), state: "fixtures-fallback" }, "community read fell back to fixtures");
    return fixtureViews();
  }
}

export type VoteResult =
  | { ok: true; market: CommunityMarketView }
  | { ok: false; error: string; status: number };

/** Cast/replace a user's vote, recompute the tally, return the updated market. */
export async function castVote(
  userId: string,
  marketId: string,
  choice: string,
): Promise<VoteResult> {
  if (!dbConfigured()) {
    return { ok: false, error: "Voting isn't available in this environment yet.", status: 503 };
  }
  try {
    const market = (await prisma.communityMarket.findUnique({
      where: { id: marketId },
    })) as unknown as Row | null;
    if (!market) return { ok: false, error: "Market not found.", status: 404 };
    if (market.status !== "open") return { ok: false, error: "This market is closed.", status: 409 };
    if (!asOptions(market.options).some((o) => o.id === choice)) {
      return { ok: false, error: "Invalid choice.", status: 400 };
    }

    await prisma.communityVote.upsert({
      where: { marketId_userId: { marketId, userId } },
      create: { marketId, userId, choice },
      update: { choice },
    });

    // Recompute the tally from source of truth (cheap; one market's votes).
    const grouped = await prisma.communityVote.groupBy({
      by: ["choice"],
      where: { marketId },
      _count: { choice: true },
    });
    const tally: Record<string, number> = {};
    let total = 0;
    for (const g of grouped) {
      tally[g.choice] = g._count.choice;
      total += g._count.choice;
    }

    const updated = (await prisma.communityMarket.update({
      where: { id: marketId },
      data: { tally, voteCount: total },
    })) as unknown as Row;

    return { ok: true, market: rowView(updated, choice, seedLabelBySlug.get(updated.slug) ?? null) };
  } catch (err) {
    log.error({ err: String(err), marketId }, "vote failed");
    return { ok: false, error: "Voting is temporarily unavailable.", status: 503 };
  }
}

// ── Community votes attached to external (Polymarket/Kalshi) markets ────────
// Each live market gets its own Combat Register vote: who-wins for head-to-head,
// Yes/No/Maybe for props. Stored as a CommunityMarket keyed by providerMarketId.

/** Batch-fetch CR community votes for a set of provider market ids. */
export async function getMarketVotes(
  ids: string[],
  userId?: string | null,
): Promise<Record<string, MarketVote>> {
  if (!dbConfigured() || ids.length === 0) return {};
  try {
    const rows = (await prisma.communityMarket.findMany({
      where: { providerMarketId: { in: ids } },
    })) as unknown as (Row & { providerMarketId: string })[];
    if (rows.length === 0) return {};

    let mine = new Map<string, string>();
    if (userId) {
      const votes = await prisma.communityVote.findMany({
        where: { userId, marketId: { in: rows.map((r) => r.id) } },
        select: { marketId: true, choice: true },
      });
      mine = new Map(votes.map((v) => [v.marketId, v.choice]));
    }
    const out: Record<string, MarketVote> = {};
    for (const r of rows) {
      out[r.providerMarketId] = {
        tally: asTally(r.tally),
        voteCount: r.voteCount,
        myVote: mine.get(r.id) ?? null,
        options: asOptions(r.options),
      };
    }
    return out;
  } catch (err) {
    log.warn({ err: String(err) }, "getMarketVotes fell back to empty");
    return {};
  }
}

export type MarketVotePayload = {
  providerMarketId: string;
  sport: string;
  title: string;
  kind: string;
  options: CommunityOption[];
  choice: string;
};

export type MarketVoteResult =
  | { ok: true; vote: MarketVote }
  | { ok: false; error: string; status: number };

/** Cast/replace a CR community vote on an external market (upserts the row). */
export async function voteOnMarket(userId: string, p: MarketVotePayload): Promise<MarketVoteResult> {
  if (!dbConfigured()) return { ok: false, error: "Voting isn't available in this environment yet.", status: 503 };
  if (!Array.isArray(p.options) || p.options.length < 2) return { ok: false, error: "Invalid options.", status: 400 };
  if (!p.options.some((o) => o.id === p.choice)) return { ok: false, error: "Invalid choice.", status: 400 };

  try {
    const market = (await prisma.communityMarket.upsert({
      where: { providerMarketId: p.providerMarketId },
      update: { title: p.title, options: p.options, sport: p.sport, kind: p.kind },
      create: {
        slug: p.providerMarketId, providerMarketId: p.providerMarketId, kind: p.kind,
        sport: p.sport, title: p.title, options: p.options, tally: {}, status: "open",
      },
      select: { id: true },
    })) as unknown as { id: string };

    await prisma.communityVote.upsert({
      where: { marketId_userId: { marketId: market.id, userId } },
      create: { marketId: market.id, userId, choice: p.choice },
      update: { choice: p.choice },
    });

    const grouped = await prisma.communityVote.groupBy({
      by: ["choice"], where: { marketId: market.id }, _count: { choice: true },
    });
    const tally: Record<string, number> = {};
    let total = 0;
    for (const g of grouped) { tally[g.choice] = g._count.choice; total += g._count.choice; }
    await prisma.communityMarket.update({ where: { id: market.id }, data: { tally, voteCount: total } });

    return { ok: true, vote: { tally, voteCount: total, myVote: p.choice, options: p.options } };
  } catch (err) {
    log.error({ err: String(err), providerMarketId: p.providerMarketId }, "market vote failed");
    return { ok: false, error: "Voting is temporarily unavailable.", status: 503 };
  }
}
