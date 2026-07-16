import Link from "next/link";
import { Trophy } from "lucide-react";
import { SectionHeading } from "@/components/section-heading";
import { RankingList } from "@/components/ranking-list";
import { getPoundForPound, getRankingBySlug } from "@/lib/repo";

export async function RankingsPreview() {
  const [p4p, heavy, light, welter] = await Promise.all([
    getPoundForPound(),
    getRankingBySlug("heavyweight"),
    getRankingBySlug("lightweight"),
    getRankingBySlug("welterweight"),
  ]);

  const divisions = [
    { data: p4p, href: "/p4p", accent: true },
    { data: heavy, href: "/rankings/heavyweight", accent: false },
    { data: light, href: "/rankings/lightweight", accent: false },
    { data: welter, href: "/rankings/welterweight", accent: false },
  ].filter((d) => d.data) as { data: NonNullable<typeof heavy>; href: string; accent: boolean }[];

  return (
    <section className="container-cr py-12">
      <SectionHeading eyebrow="Live rankings" title="Rankings" href="/rankings" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {divisions.map(({ data, href, accent }) => (
          <div
            key={data.slug}
            className={`card-surface overflow-hidden ${accent ? "ring-1 ring-gold-500/30" : ""}`}
          >
            <Link
              href={href}
              className="flex items-center justify-between border-b border-ink-700 px-4 py-3 hover:bg-ink-800/50"
            >
              <span className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-chalk">
                {accent && <Trophy className="size-4 text-gold-400" />}
                {data.weightClass}
              </span>
              <span className="text-[0.65rem] uppercase tracking-wider text-fog">Top {Math.min(5, data.rankings.length)}</span>
            </Link>
            <RankingList ranking={data} limit={5} dense showSport={accent} />
          </div>
        ))}
      </div>
    </section>
  );
}
