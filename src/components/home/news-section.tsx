import Link from "next/link";
import Image from "next/image";
import { Clock, Zap } from "lucide-react";
import { SectionHeading } from "@/components/section-heading";
import { Badge } from "@/components/ui/badge";
import { CategoryIcon } from "@/components/category-icon";
import { getArticles, getFeaturedArticle } from "@/lib/repo";
import { formatDate } from "@/lib/utils";
import { safeNewsCover } from "@/lib/media-safe";

export async function NewsSection() {
  const [articles, featured] = await Promise.all([getArticles(), getFeaturedArticle()]);
  const rest = articles.filter((a) => a.id !== featured?.id).slice(0, 4);

  return (
    <section className="container-cr py-12">
      <SectionHeading eyebrow="The Wire" title="Breaking News" href="/news" />
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Featured */}
        {featured && (
          <Link
            href={`/news/${featured.slug}`}
            className="group relative flex min-h-[20rem] flex-col justify-end overflow-hidden rounded-card border border-ink-700 p-6 lg:row-span-2 lg:min-h-full"
          >
            {(
              <div className="absolute inset-0 bg-cover bg-center opacity-70 transition-transform duration-700 group-hover:scale-105" style={{ backgroundImage: `url(${safeNewsCover(featured.slug, featured.coverImageUrl)})` }} />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/70 to-ink-950/20" />
            <div className="absolute inset-0 bg-grid opacity-20" />
            <Image src="/cr-logo.png" alt="Combat Register" width={90} height={60} className="absolute right-5 top-5 h-7 w-auto opacity-50" />
            <CategoryIcon name={featured.category} className="absolute right-6 bottom-6 size-20 text-white/[0.06]" />
            <div className="relative">
              <Badge tone="red"><Zap className="size-3" />{featured.category}</Badge>
              <h3 className="mt-3 font-display text-2xl font-bold leading-tight text-chalk transition-colors group-hover:text-blood-300 sm:text-3xl">
                {featured.title}
              </h3>
              <p className="mt-2 max-w-prose text-sm text-mist">{featured.excerpt}</p>
              <p className="mt-4 flex items-center gap-2 text-xs text-fog">
                <span>{featured.author}</span> · <Clock className="size-3" /> {formatDate(featured.publishedAt)} · {featured.views.toLocaleString()} reads
              </p>
            </div>
          </Link>
        )}

        {/* List */}
        <div className="grid gap-3">
          {rest.map((a) => (
            <Link
              key={a.id}
              href={`/news/${a.slug}`}
              className="group flex items-center gap-4 rounded-card border border-ink-700 bg-ink-900/40 p-4 transition-colors hover:border-blood-500/40 hover:bg-ink-850"
            >
              <div className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink-800 text-blood-400">
                <Image src={safeNewsCover(a.slug, a.coverImageUrl)} alt="" fill className="object-cover object-center opacity-90" sizes="56px" unoptimized />
                <span className="absolute inset-0 bg-gradient-to-t from-ink-950/80 to-transparent" />
                <CategoryIcon name={a.category} className="relative size-6 drop-shadow" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-blood-400">{a.category}</span>
                <h4 className="truncate font-display text-base font-semibold text-chalk transition-colors group-hover:text-blood-300">{a.title}</h4>
                <p className="text-xs text-fog">{formatDate(a.publishedAt)} · {a.views.toLocaleString()} reads</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
