import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { NewsFeed, type NewsItem } from "@/components/news/news-feed";
import { getArticles } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const revalidate = 300;

export const metadata: Metadata = {
  title: "News",
  description: "Breaking combat-sports news, fight announcements, analysis and championship coverage.",
};

export default async function NewsPage() {
  const articles = await getArticles();
  const items: NewsItem[] = articles.map((a) => ({
    id: a.id, slug: a.slug, title: a.title, excerpt: a.excerpt, category: a.category,
    coverImageUrl: a.coverImageUrl, sourceUrl: a.sourceUrl, author: a.author, views: a.views, publishedAt: a.publishedAt,
  }));

  return (
    <>
      <PageHero eyebrow="The Wire" title="News & Analysis" description="Breaking stories, fight announcements, and deep analysis from the Combat Register desk." />
      <div className="container-cr py-10">
        <NewsFeed articles={items} />
      </div>
    </>
  );
}
