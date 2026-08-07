// ════════════════════════════════════════════════════════════════════════
//  Wikipedia API client — search for an event page + fetch its rendered HTML.
//  Uses the shared honest fetcher (identifying UA, throttle, bounded retry).
// ════════════════════════════════════════════════════════════════════════

import { fetchPage } from "../http";

const API = process.env.WIKIPEDIA_API_URL ?? "https://en.wikipedia.org/w/api.php";

interface SearchResponse {
  query?: { search?: { title: string }[] };
}
interface ParseResponse {
  parse?: { title: string; text: { "*": string } };
  error?: { info: string };
}

/** Best-matching Wikipedia page titles for an event name. */
export async function searchPages(name: string, limit = 3): Promise<string[]> {
  const url = `${API}?action=query&list=search&srsearch=${encodeURIComponent(name)}&format=json&srlimit=${limit}`;
  const { html } = await fetchPage(url);
  const data = JSON.parse(html) as SearchResponse;
  return (data.query?.search ?? []).map((s) => s.title);
}

/**
 * Rendered HTML of a Wikipedia page, with the title it actually RESOLVED to.
 *
 * ── `redirects=1` is the whole point ─────────────────────────────────────
 * Without it, `action=parse` on a redirect returns the REDIRECT STUB — a tiny
 * page containing "This page is a redirect" and no content at all. It is not an
 * error and it is not empty, so every layer downstream treated it as a real
 * page that simply had no card on it, and the event was recorded as
 * `no_card`: a parser failure that was never a parser failure.
 *
 * Measured against the live API: `ONE X` 0 bouts → 20, and each of
 * `ONE Friday Fights 15/16/17/32/35` 0 → recovered. Wikipedia redirects
 * individual Friday Fights numbers to the series article, and every one of them
 * was landing on a stub.
 *
 * ── Why the resolved title comes back with it ────────────────────────────
 * Because following a redirect can change WHAT KIND of page you are holding.
 * `ONE Friday Fights 35` resolves to the series page, which carries 414 bouts —
 * the whole series, not one card. The candidate was classified from the
 * REQUESTED title, so it would have been scored as an event page and its 414
 * bouts attached to a single event. Returning the resolved title lets the caller
 * re-classify, so the existing season-page guard rails apply to where we landed
 * rather than to where we aimed.
 */
export interface FetchedPage {
  /** The title Wikipedia served, after following any redirect. */
  title: string;
  html: string;
}

export async function fetchPageHtml(title: string): Promise<FetchedPage | null> {
  const url = `${API}?action=parse&page=${encodeURIComponent(title)}&format=json&prop=text&redirects=1`;
  const { html } = await fetchPage(url);
  const data = JSON.parse(html) as ParseResponse;
  if (data.error || !data.parse) return null;
  return { title: data.parse.title, html: data.parse.text["*"] };
}
