import Link from "next/link";
import { getArticles } from "@/lib/repo";

// Top ticker — latest breaking news headlines only (was a fights marquee).
export async function Ticker() {
  const articles = await getArticles();
  const items = articles.slice(0, 20).map((a) => ({
    key: a.id,
    category: a.category,
    title: a.title,
    href: `/news/${a.slug}`,
  }));

  if (items.length === 0) return null;

  const doubled = [...items, ...items];

  // Constant, calm crawl regardless of headline count (~12s per item, min 120s).
  const durationSeconds = Math.max(120, items.length * 12);

  return (
    <div className="border-b border-ink-800 bg-ink-900/80">
      <div className="container-cr flex items-center gap-3 overflow-hidden py-2">
        <span className="z-10 flex shrink-0 items-center gap-1.5 rounded bg-blood-500 px-2 py-1 font-display text-[0.65rem] font-bold uppercase tracking-wider text-white">
          <span className="size-1.5 animate-pulse rounded-full bg-white" /> Breaking
        </span>
        <div className="relative flex-1 overflow-hidden mask-fade-r">
          <div
            className="animate-marquee flex w-max items-center gap-8 whitespace-nowrap"
            style={{ animationDuration: `${durationSeconds}s` }}
          >
            {doubled.map((it, i) => (
              <Link key={`${it.key}-${i}`} href={it.href} className="flex items-center gap-2 text-xs">
                <span className="text-[0.6rem] font-bold uppercase tracking-wide text-blood-400">{it.category}</span>
                <span className="font-semibold text-chalk">{it.title}</span>
                <span className="text-ink-600">•</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
