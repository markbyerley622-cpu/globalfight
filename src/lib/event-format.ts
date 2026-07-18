import type { Article, Fight, FightEvent } from "@/lib/types";

/**
 * Google Maps deep link for a venue. Uses the Maps URL API `search` form, which
 * resolves on desktop and opens the native Maps app on Android and iPhone. We
 * search by text (venue + city + country) because events carry no lat/long.
 * Returns null when there's nothing worth mapping.
 */
export function mapsUrl(event: Pick<FightEvent, "venue" | "city" | "country">): string | null {
  const query = [event.venue, event.city, event.country].filter(Boolean).join(", ");
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * Order a card the way a fight fan reads it: main event, co-main, then remaining
 * title fights, then everything else in the promotion's official card order
 * (the DB already returns fights by `orderOnCard`). A stable sort preserves that
 * official order within each tier, so we never randomise the undercard.
 */
export function orderFights(fights: Fight[]): Fight[] {
  const tier = (f: Fight) => (f.mainEvent ? 0 : f.coMain ? 1 : f.titleFight ? 2 : 3);
  return fights
    .map((f, i) => ({ f, i }))
    .sort((a, b) => tier(a.f) - tier(b.f) || a.i - b.i)
    .map(({ f }) => f);
}

/** Human label for a bout's slot on the card. */
export function boutLabel(fight: Fight, index: number): string {
  if (fight.mainEvent) return "Main event";
  if (fight.coMain) return "Co-main event";
  if (fight.titleFight) return "Title fight";
  return `Bout ${index + 1}`;
}

/**
 * YouTube search deep link for a completed bout's highlights — a pragmatic way
 * to send fans to official KO/finish clips without hosting or licensing video.
 */
export function highlightsUrl(fight: Fight): string {
  const q = `${fight.red.name} vs ${fight.blue.name} highlights`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}

// The story types that actually matter around a fight week, weighted. Coverage
// is ranked toward these so an event surfaces the press conference, weigh-in,
// faceoff, fighter updates and predictions — not every low-value rewrite.
const COVERAGE_SIGNALS: [RegExp, number][] = [
  [/press conference|presser/i, 5],
  [/weigh[- ]?in|weighin/i, 5],
  [/face[- ]?off|faceoff|staredown|stare[- ]?down/i, 4],
  [/official|announce|booked|signs|set to|to headline|confirmed/i, 4],
  [/injur|out of|withdraw|pull(s|ed)? out|replace|steps? in|medical/i, 4],
  [/predict|pick(s)?|breakdown|betting|odds|preview/i, 3],
  [/interview|reacts?|reaction|responds?|fires? back|opinion/i, 2],
  [/training|camp|open workout|footage/i, 2],
];

// Coverage buckets, in display order. First matching pattern wins; anything
// unmatched falls into "Fight news". Lets us group the feed Reddit-style with a
// heading + count per topic instead of one flat list.
const COVERAGE_GROUPS: { key: string; label: string; emoji: string; test: RegExp }[] = [
  { key: "presser", label: "Press conference", emoji: "🎤", test: /press conference|presser/i },
  { key: "weighin", label: "Weigh-ins", emoji: "⚖️", test: /weigh[- ]?in|weighin/i },
  { key: "faceoff", label: "Faceoffs", emoji: "🤜", test: /face[- ]?off|faceoff|staredown|stare[- ]?down/i },
  { key: "predictions", label: "Predictions", emoji: "📈", test: /predict|pick(s)?|breakdown|betting|odds|preview/i },
  { key: "updates", label: "Fighter updates", emoji: "🚨", test: /injur|out of|withdraw|pull(s|ed)? out|replace|steps? in|medical|announce|booked|signs/i },
  { key: "reactions", label: "Fan reactions", emoji: "🔥", test: /reacts?|reaction|responds?|fires? back|opinion|slams?|calls? out/i },
];

export interface CoverageGroup {
  key: string;
  label: string;
  emoji: string;
  articles: Article[];
}

/** Group ranked coverage into topic buckets, preserving order and dropping empties. */
export function groupCoverage(articles: Article[]): CoverageGroup[] {
  const buckets = new Map<string, Article[]>();
  const put = (k: string, a: Article) => buckets.set(k, [...(buckets.get(k) ?? []), a]);

  for (const a of articles) {
    const hay = `${a.title} ${a.category ?? ""}`;
    const g = COVERAGE_GROUPS.find((grp) => grp.test.test(hay));
    put(g?.key ?? "news", a);
  }

  const groups: CoverageGroup[] = [];
  for (const g of COVERAGE_GROUPS) {
    const arts = buckets.get(g.key);
    if (arts?.length) groups.push({ ...g, articles: arts });
  }
  const rest = buckets.get("news");
  if (rest?.length) groups.push({ key: "news", label: "Fight news", emoji: "📰", articles: rest });
  return groups;
}

/** Normalised title signature used to drop near-duplicate rewrites. */
function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()
    .split(" ").slice(0, 6).join(" ");
}

/**
 * Rank event coverage by editorial value and trim to `limit`, dropping
 * near-duplicate headlines. Input is assumed newest-first, so equal scores keep
 * their recency order (stable sort). Quality over quantity — item #14.
 */
export function rankCoverage(articles: Article[], limit = 8): Article[] {
  const seen = new Set<string>();
  const scored = articles
    .map((a, i) => {
      let score = 0;
      const hay = `${a.title} ${a.category ?? ""}`;
      for (const [re, w] of COVERAGE_SIGNALS) if (re.test(hay)) score += w;
      return { a, score, i };
    })
    .sort((x, y) => y.score - x.score || x.i - y.i);

  const out: Article[] = [];
  for (const { a } of scored) {
    const key = titleKey(a.title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
    if (out.length >= limit) break;
  }
  return out;
}
