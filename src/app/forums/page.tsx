import type { Metadata } from "next";
import Link from "next/link";
import { PenLine } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { CategoryIcon } from "@/components/category-icon";
import { CommunityFeed } from "@/components/forums/feed";
import { getForumCategories } from "@/lib/forum/repo";

export const metadata: Metadata = {
  title: "Community Forums",
  description: "Join the Combat Reviews community — discuss MMA, boxing, Muay Thai, BJJ and every combat sport. Posts persist in PostgreSQL and update in realtime.",
};

export const dynamic = "force-dynamic"; // forum content is live, never statically cached

export default async function ForumsPage() {
  const categories = await getForumCategories();
  const totalThreads = categories.reduce((a, c) => a + (c.threadCount ?? 0), 0);

  return (
    <>
      <PageHero
        eyebrow="The community"
        title="Forums"
        description="Every combat sport, one community. Vote, discuss and follow — posts are stored in the database and appear across every device in realtime."
      />

      <div className="container-cr grid gap-5 py-8 lg:grid-cols-[220px_minmax(0,1fr)_260px]">
        {/* LEFT — communities */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-4">
            <div>
              <h2 className="mb-2 px-2 font-display text-xs font-bold uppercase tracking-wider text-fog">Communities</h2>
              <nav className="space-y-0.5">
                {categories.map((c) => (
                  <Link
                    key={c.slug}
                    href={`/forums/${c.slug}`}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-ink-800"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-ink-800 text-blood-400">
                      <CategoryIcon name={c.slug} className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-chalk">r/{c.slug}</span>
                    </span>
                    <span className="text-[0.65rem] tabular-nums text-fog">{c.threadCount ?? 0}</span>
                  </Link>
                ))}
              </nav>
            </div>
          </div>
        </aside>

        {/* CENTER — feed */}
        <div className="min-w-0">
          {/* mobile community chips */}
          <div data-hscroll className="mb-3 flex gap-2 overflow-x-auto pb-1 lg:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {categories.map((c) => (
              <Link
                key={c.slug}
                href={`/forums/${c.slug}`}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink-700 px-3 py-1.5 text-xs font-semibold text-mist hover:border-blood-500/40"
              >
                <CategoryIcon name={c.slug} className="size-3.5 text-blood-400" /> r/{c.slug}
              </Link>
            ))}
          </div>
          <CommunityFeed categories={categories} />
        </div>

        {/* RIGHT — about / stats */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-4">
            <div className="card-surface p-4">
              <h3 className="font-display text-sm font-bold text-chalk">About the community</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-fog">
                Every combat sport, one community. Discuss MMA, boxing, Muay Thai, BJJ and more — posts persist in PostgreSQL and update in realtime.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-ink-800 pt-3">
                <div>
                  <p className="font-display text-lg font-bold tabular-nums text-chalk">{categories.length}</p>
                  <p className="text-[0.7rem] uppercase tracking-wide text-fog">Communities</p>
                </div>
                <div>
                  <p className="font-display text-lg font-bold tabular-nums text-chalk">{totalThreads}</p>
                  <p className="text-[0.7rem] uppercase tracking-wide text-fog">Threads</p>
                </div>
              </div>
              <Link
                href="/account"
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-blood-500 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-blood-600"
              >
                <PenLine className="size-4" /> Create a post
              </Link>
            </div>

            <div className="card-surface p-4">
              <h3 className="mb-2 font-display text-xs font-bold uppercase tracking-wider text-fog">Top communities</h3>
              <ol className="space-y-1.5">
                {[...categories]
                  .sort((a, b) => (b.threadCount ?? 0) - (a.threadCount ?? 0))
                  .slice(0, 5)
                  .map((c, i) => (
                    <li key={c.slug}>
                      <Link href={`/forums/${c.slug}`} className="flex items-center gap-2 text-sm hover:text-blood-300">
                        <span className="w-4 font-bold tabular-nums text-fog">{i + 1}</span>
                        <span className="truncate font-semibold text-chalk">r/{c.slug}</span>
                        <span className="ml-auto text-[0.7rem] text-fog">{c.threadCount ?? 0}</span>
                      </Link>
                    </li>
                  ))}
              </ol>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
