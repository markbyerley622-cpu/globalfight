// Upserts a DataSource row for every registered (licensed) provider plus the
// facts-only Wikipedia/RSS source. Idempotent — safe to call at the start of
// any sync.

import { prisma } from "@/lib/db";
import { PROVIDERS } from "../providers/registry";

interface SeedRow { key: string; label: string; kind: "API" | "SCRAPER" | "MANUAL"; baseConfidence: number }

export async function ensureDataSources(): Promise<void> {
  const rows: SeedRow[] = [
    ...PROVIDERS.map((p) => ({ key: p.key, label: p.label, kind: "API" as const, baseConfidence: 0.85 })),
    { key: "scraper", label: "Wikipedia / RSS (facts only)", kind: "SCRAPER", baseConfidence: 0.55 },
  ];
  await prisma.$transaction(
    rows.map((r) =>
      prisma.dataSource.upsert({
        where: { key: r.key },
        update: { label: r.label, kind: r.kind },
        create: r,
      }),
    ),
  );
}
