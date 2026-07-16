import Link from "next/link";
import { MessageSquare, Eye, Pin, Flame } from "lucide-react";
import { SectionHeading } from "@/components/section-heading";
import { CategoryIcon } from "@/components/category-icon";
import { getForumCategories, getThreads } from "@/lib/forum/repo";
import { timeAgo } from "@/lib/utils";

export async function Community() {
  const [{ items: threads }, categories] = await Promise.all([
    getThreads({ limit: 5 }),
    getForumCategories(),
  ]);

  return (
    <section className="border-t border-ink-800 bg-ink-900/40 py-12">
      <div className="container-cr">
        <SectionHeading eyebrow="Join the conversation" title="Community Discussions" href="/forums" />
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          {/* Threads */}
          <div className="card-surface divide-y divide-ink-800 overflow-hidden">
            {threads.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-fog">No discussions yet — <Link href="/forums" className="text-blood-400 hover:text-blood-300">start one</Link>.</p>
            )}
            {threads.map((t) => (
              <Link
                key={t.id}
                href={`/forums/${t.categorySlug}/${t.slug}`}
                className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-ink-800/60"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-ink-800 text-mist">
                  {t.pinned ? <Pin className="size-4 text-gold-400" /> : <Flame className="size-4 text-blood-400" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-sm font-semibold text-chalk">{t.title}</p>
                  <p className="text-xs text-fog">{t.categoryName} · by {t.authorName} · {timeAgo(t.lastPostAt)}</p>
                </div>
                <div className="hidden shrink-0 items-center gap-4 text-xs text-mist sm:flex">
                  <span className="flex items-center gap-1"><MessageSquare className="size-3.5" />{t.replyCount}</span>
                  <span className="flex items-center gap-1"><Eye className="size-3.5" />{t.views}</span>
                </div>
              </Link>
            ))}
          </div>

          {/* Categories */}
          <div className="card-surface p-4">
            <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-fog">Categories</h3>
            <div className="grid gap-2">
              {categories.slice(0, 8).map((c) => (
                <Link
                  key={c.slug}
                  href={`/forums/${c.slug}`}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-ink-800"
                >
                  <span className="flex size-9 items-center justify-center rounded-lg bg-ink-800 text-blood-400">
                    <CategoryIcon name={c.slug} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-display text-sm font-semibold text-chalk">{c.name}</p>
                    <p className="truncate text-xs text-fog">{c.description}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
