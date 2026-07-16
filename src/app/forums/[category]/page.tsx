import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { ThreadList } from "@/components/forums/thread-list";
import { getForumCategories } from "@/lib/forum/repo";
import { FORUM_CATEGORY_SEED } from "@/lib/forum/types";

export function generateStaticParams() {
  return FORUM_CATEGORY_SEED.map((c) => ({ category: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const { category } = await params;
  const c = FORUM_CATEGORY_SEED.find((x) => x.slug === category);
  return c ? { title: `${c.name} — Forums`, description: c.description } : {};
}

export const dynamic = "force-dynamic";

export default async function ForumCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const categories = await getForumCategories();
  const cat = categories.find((c) => c.slug === category);
  if (!cat) notFound();

  return (
    <>
      <PageHero eyebrow="Forums" title={cat.name} description={cat.description ?? undefined} />
      <div className="container-cr max-w-4xl py-10">
        <Link href="/forums" className="mb-4 inline-flex items-center gap-1.5 text-sm text-mist hover:text-blood-400">
          <ArrowLeft className="size-4" /> All categories
        </Link>
        <ThreadList categorySlug={cat.slug} categories={categories} />
      </div>
    </>
  );
}
