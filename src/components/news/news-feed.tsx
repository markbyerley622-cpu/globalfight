"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CategoryIcon } from "@/components/category-icon";
import { cn, formatDate } from "@/lib/utils";
import { safeNewsCover } from "@/lib/media-safe";

export type NewsItem = {
  id: string; slug: string; title: string; excerpt?: string; category: string;
  coverImageUrl?: string; sourceUrl?: string; author?: string; views: number; publishedAt: string;
};

/** Article link: opens the original source in a new tab when we have its URL,
 *  otherwise falls back to the internal article page. */
function ArticleLink({ item, className, children }: { item: NewsItem; className?: string; children: React.ReactNode }) {
  if (item.sourceUrl) {
    return (
      <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={`/news/${item.slug}`} className={className}>
      {children}
    </Link>
  );
}

const CHUNK = 12;
/** How far down the newest articles the hero may reach to find one with a cover. */
const LEAD_WINDOW = 8;

// All disciplines the site covers — shown as filters even before any article
// carries that category. Merged with whatever categories the data actually has.
const DISCIPLINES = ["Boxing", "MMA", "Muay Thai", "Kickboxing", "Bare Knuckle", "BJJ", "Wrestling", "Misfits"];

/** Category filter + infinite scroll (no pager). Categories are derived from the
 *  articles present, so it works for editorial or sport-discipline categories. */
export function NewsFeed({ articles }: { articles: NewsItem[] }) {
  const [cat, setCat] = useState("All");
  const [visible, setVisible] = useState(CHUNK);
  const sentinel = useRef<HTMLDivElement>(null);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set([...DISCIPLINES, ...articles.map((a) => a.category).filter(Boolean)]))],
    [articles],
  );
  const filtered = useMemo(
    () => (cat === "All" ? articles : articles.filter((a) => a.category === cat)),
    [articles, cat],
  );

  useEffect(() => { setVisible(CHUNK); }, [cat]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setVisible((v) => Math.min(v + CHUNK, filtered.length));
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length]);

  const shown = filtered.slice(0, visible);
  // The hero is the only full-bleed image on the page (18rem tall), so a lead
  // with no publisher cover renders as generated art — the emptiest possible
  // first impression. Most items come from Google News RSS, which carries no
  // syndication image, so the newest article usually has none and the hero was
  // blank far more often than not. Prefer the newest article that actually has
  // a cover, bounded to LEAD_WINDOW so the hero stays current rather than
  // reaching back for an old article just because it had a photo.
  const lead = shown.slice(0, LEAD_WINDOW).find((a) => a.coverImageUrl) ?? shown[0];
  const rest = shown.filter((a) => a !== lead);

  return (
    <>
      {/* Category filter */}
      <div data-hscroll className="hide-scrollbar mb-6 flex gap-2 overflow-x-auto">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
              cat === c ? "border-chalk bg-chalk text-ink-950" : "border-ink-700 bg-ink-900/60 text-mist hover:border-ink-600 hover:text-chalk",
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-fog">No {cat === "All" ? "" : `${cat} `}news yet.</p>
      ) : (
        <>
          {lead && (
            <ArticleLink item={lead} className="group mb-8 block">
              <div className="relative flex min-h-[18rem] flex-col justify-end overflow-hidden rounded-card border border-ink-700 p-8">
                <div className="absolute inset-0 bg-cover bg-center opacity-70 transition-transform duration-700 group-hover:scale-105" style={{ backgroundImage: `url(${safeNewsCover(lead.slug, lead.coverImageUrl)})` }} />
                <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/70 to-ink-950/20" />
                <div className="absolute inset-0 bg-grid opacity-15" />
                <Image src="/cr-logo.png" alt="Combat Reviews" width={100} height={66} className="absolute right-6 top-6 h-8 w-auto opacity-50" />
                <div className="relative max-w-2xl">
                  <Badge tone="red">{lead.category}</Badge>
                  <h2 className="mt-3 font-display text-3xl font-bold leading-tight text-chalk group-hover:text-blood-300 sm:text-4xl">{lead.title}</h2>
                  {lead.excerpt && <p className="mt-3 text-sm text-mist">{lead.excerpt}</p>}
                  <p className="mt-4 text-xs text-fog">{lead.author ? `${lead.author} · ` : ""}{formatDate(lead.publishedAt)}</p>
                </div>
              </div>
            </ArticleLink>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((a) => (
              <ArticleLink key={a.id} item={a} className="group card-surface flex flex-col overflow-hidden transition-all hover:border-blood-500/40">
                <div className="relative flex h-36 items-center justify-center overflow-hidden bg-gradient-to-br from-ink-800 to-ink-900">
                  <Image src={safeNewsCover(a.slug, a.coverImageUrl)} alt="" fill className="object-cover object-center opacity-80 transition-transform duration-500 group-hover:scale-105" sizes="(max-width:1024px) 50vw, 33vw" unoptimized />
                  <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/45 to-transparent" />
                  <Image src="/cr-logo.png" alt="" width={70} height={46} className="absolute left-3 top-3 h-5 w-auto opacity-55" />
                  <CategoryIcon name={a.category} className="relative size-12 text-white/15" />
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <Badge tone="neutral">{a.category}</Badge>
                  <h3 className="mt-2 font-display text-base font-bold leading-tight text-chalk group-hover:text-blood-300">{a.title}</h3>
                  {a.excerpt && <p className="mt-1 line-clamp-2 text-xs text-mist">{a.excerpt}</p>}
                  <p className="mt-auto flex items-center gap-1.5 pt-3 text-xs text-fog">
                    <Clock className="size-3" /> {formatDate(a.publishedAt)} · {a.views.toLocaleString()} reads
                  </p>
                </div>
              </ArticleLink>
            ))}
          </div>

          {visible < filtered.length && <div ref={sentinel} className="h-10" />}
        </>
      )}
    </>
  );
}
