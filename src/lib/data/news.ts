import type { Article } from "@/lib/types";

export const ARTICLES: Article[] = [
  {
    id: "a1",
    slug: "usyk-joshua-trilogy-confirmed-wembley",
    title: "It's Official: Usyk–Joshua III Lands at Wembley This Summer",
    excerpt:
      "The undisputed heavyweight champion returns to London for a third meeting with Anthony Joshua in front of 90,000 fans.",
    category: "Breaking News",
    featured: true,
    author: "Marcus Reid",
    views: 48230,
    publishedAt: "2026-05-29T09:00:00Z",
    coverImageUrl: "/fighters/oleksandr-usyk/hero.webp",
    content:
      "Oleksandr Usyk will defend his unified heavyweight crown against Anthony Joshua for a third time...",
  },
  {
    id: "a2",
    slug: "inoue-nakatani-tokyo-dome-superfight",
    title: "Inoue vs Nakatani: Inside Japan's Biggest Fight Ever Made",
    excerpt:
      "Two of the pound-for-pound elite collide at the Tokyo Dome. We break down the styles, the stakes, and the history.",
    category: "Analysis",
    featured: false,
    author: "Yuki Tanaka",
    views: 31980,
    publishedAt: "2026-05-28T14:30:00Z",
    coverImageUrl: "/fighters/naoya-inoue/hero.webp",
    content: "When The Monster meets the rangy southpaw...",
  },
  {
    id: "a3",
    slug: "crawford-canelo-undisputed-review",
    title: "Crawford Makes History: Tactical Masterclass Over Canelo",
    excerpt:
      "Terence Crawford moved up two divisions and out-boxed the Mexican star to become a three-weight undisputed champion.",
    category: "Championships",
    featured: false,
    author: "Andre Sloane",
    views: 67120,
    publishedAt: "2026-05-03T08:00:00Z",
    coverImageUrl: "/fighters/terence-crawford/hero.webp",
    content: "On a record-breaking Netflix night...",
  },
  {
    id: "a4",
    slug: "p4p-shakeup-crawford-rises",
    title: "Pound-for-Pound Shakeup: Crawford Climbs to No. 3",
    excerpt:
      "Our updated P4P board reflects a seismic May. Where do Inoue, Usyk, and Bud now stand?",
    category: "Rankings",
    featured: false,
    author: "Editorial Desk",
    views: 22410,
    publishedAt: "2026-05-27T11:00:00Z",
    coverImageUrl: "/fighters/terence-crawford/hero.webp",
    content: "The rankings committee convened...",
  },
  {
    id: "a5",
    slug: "davis-stevenson-styles-make-fights",
    title: "Davis vs Stevenson: Can Power Solve Precision?",
    excerpt:
      "A genuine pick'em between two of America's best 135-pounders. Our prediction model has it razor-thin.",
    category: "Predictions",
    featured: false,
    author: "Data Team",
    views: 18760,
    publishedAt: "2026-05-26T16:45:00Z",
    coverImageUrl: "/fighters/gervonta-davis/hero.webp",
    content: "Our model ingests 40+ features per fighter...",
  },
  {
    id: "a6",
    slug: "benavidez-bivol-riyadh-announced",
    title: "Benavidez–Bivol Set for Riyadh in September",
    excerpt: "El Monstruo finally gets his man. The light heavyweight title clash is official.",
    category: "Fight Announcements",
    featured: false,
    author: "Marcus Reid",
    views: 14230,
    publishedAt: "2026-05-25T10:15:00Z",
    coverImageUrl: "/fighters/david-benavidez/hero.webp",
    content: "After two years of calling him out...",
  },
];

// Forum data is fully database-backed (see src/lib/forum/repo.ts). The old
// FORUM_CATEGORIES / FORUM_THREADS fixtures were removed when the forum moved
// to Postgres + realtime.
