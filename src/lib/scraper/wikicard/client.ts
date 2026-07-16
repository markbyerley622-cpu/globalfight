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

/** Rendered HTML of a Wikipedia page, or null when it doesn't exist. */
export async function fetchPageHtml(title: string): Promise<string | null> {
  const url = `${API}?action=parse&page=${encodeURIComponent(title)}&format=json&prop=text`;
  const { html } = await fetchPage(url);
  const data = JSON.parse(html) as ParseResponse;
  if (data.error || !data.parse) return null;
  return data.parse.text["*"];
}
