import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PROVIDERS } from "@/services/providers/registry";
import { sourcePriority } from "@/services/aggregator/priority";
import { SPORTS } from "@/lib/sports";

export const dynamic = "force-dynamic";

const isAdmin = (role: string) => role === "ADMIN" || role === "MODERATOR";

// Powers /admin/data. Combines static provider config with live health/sync
// telemetry. If the data-intelligence tables aren't pushed yet it still returns
// the provider config with migrated:false so the page renders a setup hint.
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const providers = PROVIDERS.map((p) => ({
    key: p.key,
    label: p.label,
    sports: [...p.sports],
    configured: p.isConfigured(),
  }));

  // Coverage by sport: which ranked sources cover each sport.
  const coverage = SPORTS.map((s) => ({
    sport: s.value,
    label: s.label,
    sources: sourcePriority(s.value).map((r) => r.key),
  }));

  let migrated = true;
  let recentSyncs: unknown[] = [];
  let health: unknown[] = [];
  try {
    recentSyncs = await prisma.providerSync.findMany({ orderBy: { startedAt: "desc" }, take: 25 });
    // Latest health row per source.
    const sources = await prisma.dataSource.findMany({ select: { key: true } });
    health = await Promise.all(
      sources.map(async (src) => {
        const last = await prisma.providerHealth.findFirst({
          where: { sourceKey: src.key },
          orderBy: { checkedAt: "desc" },
        });
        return { sourceKey: src.key, last };
      }),
    );
  } catch {
    migrated = false; // tables not created yet — run `npm run db:push`
  }

  return NextResponse.json({ migrated, providers, coverage, recentSyncs, health });
}
