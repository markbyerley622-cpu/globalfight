import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Clock, ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CategoryIcon } from "@/components/category-icon";
import { getArticle, getArticles } from "@/lib/repo";
import { SITE } from "@/lib/config";
import { recommendVideos, disciplineFromCategory } from "@/lib/feed/recommend";
import { VideoRail } from "@/components/feed/video-rail";
import { PROMOTIONS } from "@/lib/promotions";
import { formatDate } from "@/lib/utils";

// News links go straight to the original article (see the redirect below); this
// internal page is only a redirect hop + a fallback for the rare article with no
// stored source URL yet. (Already force-dynamic — see the export lower down.)

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const a = await getArticle(slug);
  if (!a) return {};
  return {
    title: a.title,
    description: a.excerpt,
    openGraph: { title: a.title, description: a.excerpt, type: "article", publishedTime: a.publishedAt },
    alternates: { canonical: `/news/${slug}` },
  };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = await getArticle(slug);
  if (!article) notFound();
  // Straight to the original article whenever we have its URL.
  if (article.sourceUrl) redirect(article.sourceUrl);
  const related = (await getArticles()).filter((a) => a.id !== article.id).slice(0, 3);

  // Video for this story, from what the article already carries: its category
  // (a sport name) and any promotion named in the headline. NOTE: every article
  // currently in the database has a sourceUrl and is redirected off-site above,
  // so this only renders for CMS-authored pieces — see the audit note in the
  // commit. It is wired now so the first hand-written article gets it free.
  const articleVideos = await recommendVideos({
    disciplines: [disciplineFromCategory(article.category)].filter((x): x is string => !!x),
    promotions: PROMOTIONS.filter((pr) =>
      pr.aliases.some((a) => a.length >= 5 && article.title.toLowerCase().includes(a)),
    ).map((pr) => pr.slug),
    limit: 4,
  });

  const jsonLd = {
    "@context": "https://schema.org", "@type": "NewsArticle",
    headline: article.title, description: article.excerpt,
    datePublished: article.publishedAt, author: { "@type": "Person", name: article.author },
    publisher: { "@type": "Organization", name: SITE.name },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <article className="container-cr max-w-3xl py-10">
        <Link href="/news" className="mb-6 inline-flex items-center gap-1.5 text-sm text-mist hover:text-blood-400">
          <ArrowLeft className="size-4" /> All news
        </Link>
        <Badge tone="red">{article.category}</Badge>
        <h1 className="mt-3 font-display text-3xl font-bold leading-tight text-chalk sm:text-4xl lg:text-5xl">{article.title}</h1>
        <p className="mt-4 flex items-center gap-2 text-sm text-fog">
          By <span className="text-mist">{article.author}</span> · <Clock className="size-3.5" /> {formatDate(article.publishedAt)} · {article.views.toLocaleString()} reads
        </p>

        <div className="relative my-8 flex h-56 items-center justify-center overflow-hidden rounded-card bg-gradient-to-br from-blood-900/30 via-ink-800 to-ink-900 sm:h-72">
          {article.coverImageUrl && <Image src={article.coverImageUrl} alt="" fill className="object-cover object-center opacity-70" sizes="100vw" priority />}
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/55 to-transparent" />
          <div className="absolute inset-0 bg-grid opacity-15" />
          <Image src="/cr-logo.png" alt="Combat Register" width={120} height={80} className="absolute bottom-4 right-4 h-8 w-auto opacity-55" />
          <CategoryIcon name={article.category} className="relative size-20 text-white/10" />
        </div>

        <div className="prose-cr space-y-4 text-base leading-relaxed text-mist">
          <p className="text-lg text-chalk">{article.excerpt}</p>
          <p>{article.content}</p>
          <p>
            This article is part of the Combat Register editorial coverage. In production, full rich-text content is
            authored in the CMS with embedded fight cards, pull quotes, and related-fighter modules.
          </p>
        </div>
      </article>

      <div className="container-cr max-w-3xl border-t border-ink-800 py-8">
<VideoRail videos={articleVideos} title="Watch related" moreHref="/clips" />
        <h2 className="mb-4 font-display text-lg font-bold uppercase text-chalk">Related</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {related.map((a) => (
            <Link key={a.id} href={`/news/${a.slug}`} className="card-surface p-4 hover:border-blood-500/40">
              <Badge tone="neutral">{a.category}</Badge>
              <h3 className="mt-2 font-display text-sm font-semibold text-chalk">{a.title}</h3>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
