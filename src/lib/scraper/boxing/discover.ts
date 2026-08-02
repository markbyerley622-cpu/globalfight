// ════════════════════════════════════════════════════════════════════════════
//  discover() — Wikipedia CATEGORY membership.
//
//  The third discovery shape in this codebase, and the only new capability the
//  boxing provider needs:
//
//    promotion-index  a table of cards in one article        (Misfits)
//    year-page        one article per SEASON, split apart    (ONE, GLORY)
//    category         one article per CARD, enumerated by    (boxing)
//                     category membership
//
//  Boxing needs the third because it has no annual round-up article and no
//  single promoter whose page indexes the sport — but it does have a per-fight
//  article for every notable card, and Wikipedia files them by year.
//
//  Everything downstream is unchanged: the member articles carry the same
//  infobox + results table that pageMeta() and parseWikiCard() already read.
// ════════════════════════════════════════════════════════════════════════════

import { fetchPage } from "../http";

const API = process.env.WIKIPEDIA_API_URL ?? "https://en.wikipedia.org/w/api.php";

/** MediaWiki caps a category listing at 500 per request; we page with cmcontinue. */
const PAGE_SIZE = 500;

/** Bounded so a mis-typed category can never spin forever. */
const MAX_PAGES = 10;

interface CategoryResponse {
  query?: { categorymembers?: { title: string; ns: number }[] };
  continue?: { cmcontinue?: string };
  error?: { info: string };
}

/**
 * Article titles in a category.
 *
 * `ns: 0` only — a category also contains its SUBCATEGORIES (ns 14) and
 * occasionally template or file pages. Fetching a subcategory as if it were an
 * event article costs a request and yields nothing, and "Category:2025 boxing
 * matches" would be stored as an event name.
 *
 * Returns [] when the category does not exist, which is the normal case for a
 * future year — the caller probes forward and stops, rather than being told the
 * year is an error.
 */
export async function categoryMembers(category: string): Promise<string[]> {
  const titles: string[] = [];
  let cont: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url =
      `${API}?action=query&list=categorymembers` +
      `&cmtitle=${encodeURIComponent(`Category:${category}`)}` +
      `&cmlimit=${PAGE_SIZE}&cmnamespace=0&format=json` +
      (cont ? `&cmcontinue=${encodeURIComponent(cont)}` : "");

    const { html: raw } = await fetchPage(url);
    const data = JSON.parse(raw) as CategoryResponse;
    if (data.error) return titles; // non-existent category: not an error to the caller

    for (const m of data.query?.categorymembers ?? []) {
      if (m.ns === 0) titles.push(m.title);
    }

    cont = data.continue?.cmcontinue;
    if (!cont) break;
  }

  return titles;
}

/**
 * Article titles that are NOT a single professional card, even though the
 * category files them there.
 *
 * Refused before the fetch rather than after, because each costs a request and
 * would parse into something wrong rather than into nothing:
 *
 *   • amateur/championship tournaments span weeks and many divisions — the
 *     tournament provider's shape, not a card;
 *   • "Boxing at the …" is a multi-day Games competition;
 *   • a year-in-promotion round-up is the SEASON page whose over-attach the
 *     promotion-index path already refuses by name.
 */
const NOT_A_CARD =
  /^(boxing at the|list of)\b|world boxing championships|world boxing cup|olympic|asian games|sea games|islamic solidarity|youth games|^\d{4} in\b/i;

export function isCardArticle(title: string): boolean {
  return !NOT_A_CARD.test(title.trim());
}
