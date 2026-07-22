import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { BadgeCheck, Users, Plus, MapPin } from "lucide-react";
import { prisma } from "@/lib/db";
import { getPresenceCounts } from "@/lib/geo/presence";
import { Chip, ChipRow } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { DISCIPLINES } from "@/lib/roles";

export const metadata: Metadata = {
  title: "Gyms",
  description: "Every gym, academy and training room on Combat Reviews — find where to train, and who trains there.",
  alternates: { canonical: "/gyms" },
};

export const dynamic = "force-dynamic";

export default async function GymsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; d?: string; v?: string }>;
}) {
  const { q, d, v } = await searchParams;
  const query = q?.trim() ?? "";
  const discipline = DISCIPLINES.includes(d as never) ? d! : "";
  const verifiedOnly = v === "1";
  const qs = (next: Record<string, string>) => {
    const p = new URLSearchParams();
    const merged = { q: query, d: discipline, v: verifiedOnly ? "1" : "", ...next };
    for (const [k, val] of Object.entries(merged)) if (val) p.set(k, val);
    const str = p.toString();
    return str ? `/gyms?${str}` : "/gyms";
  };

  const gyms = await prisma.gym.findMany({
    where: {
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { city: { contains: query, mode: "insensitive" } },
              { country: { contains: query, mode: "insensitive" } },
              { disciplines: { has: query } },
            ],
          }
        : {}),
      ...(discipline ? { disciplines: { has: discipline } } : {}),
      ...(verifiedOnly ? { verified: true } : {}),
    },
    orderBy: [{ verified: "desc" }, { memberCount: "desc" }, { name: "asc" }],
    take: 60,
    select: {
      id: true, slug: true, name: true, city: true, country: true,
      logoUrl: true, verified: true, memberCount: true, disciplines: true,
    },
  });

  const present = await getPresenceCounts("gym", gyms.map((g) => g.id));

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-16 pt-5 lg:max-w-3xl">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Where you train</p>
          <h1 className="mt-1.5 font-display text-2xl font-black uppercase tracking-tight text-chalk">Gyms</h1>
          <p className="mt-1 text-sm text-fog">Find a gym, see who trains there, and check in.</p>
        </div>
        <Link
          href="/gyms/new"
          className="tap mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blood-500 px-3.5 py-2 font-display text-[0.7rem] font-bold uppercase tracking-wide text-white hover:bg-blood-400"
        >
          <Plus className="size-3.5" /> Add gym
        </Link>
      </header>

      <form className="mb-4" action="/gyms">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search gyms, cities or disciplines…"
          className="w-full rounded-xl border border-ink-700 bg-ink-900 px-4 py-2.5 text-sm text-chalk placeholder:text-fog focus:border-ink-600 focus:outline-none"
        />
      </form>

      <ChipRow className="mb-4">
        <Chip href={qs({ v: verifiedOnly ? "" : "1" })} active={verifiedOnly} size="sm">Verified</Chip>
        {DISCIPLINES.map((x) => (
          <Chip key={x} href={qs({ d: discipline === x ? "" : x })} active={discipline === x} tone="neutral" size="sm">
            {x}
          </Chip>
        ))}
      </ChipRow>

      {gyms.length === 0 ? (
        <EmptyState
          icon={<MapPin className="size-5" />}
          title={query || discipline || verifiedOnly ? "No gyms match that" : "No gyms yet"}
          body={
            query || discipline || verifiedOnly
              ? "Try a different name, city or discipline — or add it if it's missing."
              : "Add the gym you train at. It appears on the map for everyone nearby, and on your profile."
          }
          action={{ href: "/gyms/new", label: "Add a gym" }}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {gyms.map((g) => {
            const here = present.get(g.id) ?? 0;
            return (
              <li key={g.id}>
                <Link
                  href={`/gyms/${g.slug}`}
                  className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-900/60 p-3 transition-colors hover:border-volt-500/40 hover:bg-ink-900"
                >
                  <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-volt-500/25 bg-volt-500/10">
                    {g.logoUrl ? (
                      <Image src={g.logoUrl} alt="" width={44} height={44} unoptimized className="size-full object-cover" />
                    ) : (
                      <span className="font-display text-sm font-black text-volt-400">
                        {g.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-display text-sm font-bold text-chalk">{g.name}</span>
                      {g.verified && <BadgeCheck className="size-3.5 shrink-0 text-volt-400" />}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-[0.72rem] text-fog">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3" />
                        {[g.city, g.country].filter(Boolean).join(", ") || "Location unknown"}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3" /> {g.memberCount}
                      </span>
                    </span>
                  </span>
                  {here > 0 && (
                    <span className="shrink-0 rounded-lg bg-blood-500/15 px-2 py-1 font-display text-[0.66rem] font-bold uppercase tracking-wide text-blood-300">
                      {here} here
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
