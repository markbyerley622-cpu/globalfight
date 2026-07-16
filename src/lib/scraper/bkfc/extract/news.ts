// ════════════════════════════════════════════════════════════════════════
//  BKFC provider — news article extractor.
//
//  BKFC news pages carry no JSON-LD, so this is DOM-only: the hero heading is
//  the title, the sibling <p> is the date, `.article_body .w-richtext` is the
//  body, and og:image is the cover.
//
//  NOTE: /news is Disallow-ed in BKFC's robots.txt and the "bkfc-news" ingest
//  source is gated in the ingestion registry. The extractor is complete so the
//  section can be enabled the moment a licensed/authorised basis exists.
// ════════════════════════════════════════════════════════════════════════

import * as cheerio from "cheerio";
import type { BkfcArticle } from "../types";
import { clean, slugFromUrl, parseHumanDate } from "../normalize";

const DATE_RE = /[A-Z][a-z]+ \d{1,2},? \d{4}/;

/** Parse a news article page into a normalized BkfcArticle. */
export function parseArticlePage(html: string, url: string): BkfcArticle | null {
  const $ = cheerio.load(html);
  const slug = slugFromUrl(url);
  if (!slug) return null;

  const title =
    clean($("h1.hero_heading-4, h1.is--article, h1").first().text()) ?? slug.replace(/-/g, " ");

  // The published date is the first date-looking <p> in the hero content.
  let publishedAt: string | null = null;
  $(".hero_content p, .hero_heading-4 ~ p, article p").each((_, p) => {
    if (publishedAt) return;
    const t = clean($(p).text());
    if (t && DATE_RE.test(t)) publishedAt = parseHumanDate(t.match(DATE_RE)?.[0] ?? null);
  });

  const bodyEl = $(".article_body .w-richtext, .text-rich-text-3, .article_body").first();
  const content = clean(bodyEl.text());
  const excerpt =
    clean($('meta[name="description"], meta[property="og:description"]').attr("content")) ??
    (content ? content.slice(0, 297).trimEnd() + (content.length > 297 ? "…" : "") : null);

  const coverImageUrl =
    clean($('meta[property="og:image"]').attr("content")) ??
    clean($(".hero_image img, .article_body img").first().attr("src"));

  // Category: first tag chip that is a plain label (event cross-links are
  // rendered as <a class="article_tag-3">, so we skip anchors).
  let category: string | null = null;
  $("div.article_tag-3").each((_, el) => {
    if (category) return;
    const t = clean($(el).text());
    if (t && t.length < 40) category = t;
  });

  return {
    slug,
    url,
    title,
    excerpt,
    content,
    category,
    author: null, // BKFC does not attribute a byline in the markup.
    coverImageUrl,
    publishedAt,
  };
}
