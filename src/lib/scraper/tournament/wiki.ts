// ════════════════════════════════════════════════════════════════════════
//  Wikipedia access for the tournament provider.
//
//  Goes through the shared honest fetcher (identifying UA, global throttle,
//  bounded retry, ENABLE_SCRAPER gate) — the same client the wikicard provider
//  uses. Nothing here parses bouts; that is bracket.ts / medals.ts.
// ════════════════════════════════════════════════════════════════════════

import * as cheerio from "cheerio";
import { fetchPage } from "../http";

const API = process.env.WIKIPEDIA_API_URL ?? "https://en.wikipedia.org/w/api.php";

interface ParseResponse {
  parse?: { title: string; text: { "*": string } };
  error?: { info: string };
}

/** Rendered HTML of a page, or null when the title does not exist. */
export async function wikiPage(title: string): Promise<{ title: string; html: string } | null> {
  const url = `${API}?action=parse&page=${encodeURIComponent(title)}&format=json&prop=text&redirects=1`;
  const { html: raw } = await fetchPage(url);
  const data = JSON.parse(raw) as ParseResponse;
  if (data.error || !data.parse) return null;
  return { title: data.parse.title, html: data.parse.text["*"] };
}

/**
 * Pages that are NOT one division's competition, even though they are titled
 * like one. Their content would parse to nothing useful, so they are refused
 * before the fetch rather than after.
 */
const NOT_A_DIVISION = /qualification|medal table|participating|squads|mixed team|team event|schedule|venues?$/i;

/**
 * Division sub-articles linked from a championship hub.
 *
 * Wikipedia titles these "{hub} – {division}" with an EN DASH. The separator is
 * a formatting detail, so a hyphen and an em dash are accepted too.
 */
export function subArticles(html: string, hub: string): { title: string; division: string }[] {
  const $ = cheerio.load(html);
  const out = new Map<string, string>();

  $("a[href^='/wiki/']").each((_, a) => {
    const title = ($(a).attr("title") ?? "").trim();
    if (!title || title === hub || !title.startsWith(hub)) return;
    const rest = title.slice(hub.length);
    const m = /^\s*[–—-]\s*(.+)$/.exec(rest);
    if (!m) return;
    const division = m[1].trim();
    if (!division || NOT_A_DIVISION.test(division)) return;
    out.set(title, division);
  });

  return [...out].map(([title, division]) => ({ title, division }));
}

/**
 * The date an event happened, from the infobox.
 *
 * Formats in the wild: "7 August 2024", "17–18 September 2023", "9–10 August
 * 2024", "24 September – 1 October 2023", "August 7, 2024". Rather than a
 * regex per shape, the YEAR and the FIRST day-month pair are read separately and
 * recombined — which handles a range that spans two months without special-casing it.
 *
 * Returns midday UTC. A bare calendar date stored as midnight UTC displays as the
 * previous day everywhere west of Greenwich, and these are date-only facts.
 */
export function parseWikiDate(text: string): string | null {
  if (!text) return null;
  const year = /\b(19|20)\d{2}\b/.exec(text);
  if (!year) return null;

  const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";
  const dayFirst = new RegExp(`\\b(\\d{1,2})\\s*(?:[–—-]\\s*\\d{1,2}\\s*)?(${MONTHS})\\b`, "i").exec(text);
  const monthFirst = new RegExp(`\\b(${MONTHS})\\s+(\\d{1,2})\\b`, "i").exec(text);

  const monthName = (dayFirst?.[2] ?? monthFirst?.[1] ?? "").toLowerCase();
  const day = Number.parseInt(dayFirst?.[1] ?? monthFirst?.[2] ?? "", 10);
  if (!monthName || !Number.isFinite(day) || day < 1 || day > 31) return null;

  const month = MONTHS.split("|").indexOf(monthName);
  if (month < 0) return null;

  const iso = new Date(Date.UTC(Number.parseInt(year[0], 10), month, day, 12, 0, 0));
  return Number.isNaN(+iso) ? null : iso.toISOString();
}

/**
 * An event name whose SLUG is unique to the division.
 *
 * `slugify` (lib/utils) collapses every non-alphanumeric run to a hyphen, so
 * "Men's +80 kg" and "Men's 80 kg" both become "men-s-80-kg". persist.ts upserts a
 * new event by that slug, so the second of the pair does not create a row — it
 * overwrites the first and hangs its bouts on it. That happened: the Olympic
 * "Men's 80 kg" and "Men's +80 kg" divisions merged into one 40-bout event, and
 * the same for "Women's 67 kg" / "Women's +67 kg".
 *
 * Every bracket sport has this collision, because every one of them has a
 * heaviest "+N kg" class sitting directly above an "N kg" class. Spelling the
 * plus out fixes the slug and reads correctly to a human. The division label kept
 * on the bout is left exactly as the source printed it.
 */
export function disambiguateName(title: string): string {
  return title.replace(/(^|\s)\+(\d)/g, "$1over $2");
}

export interface PageMeta {
  date: string | null;
  venue: string | null;
  city: string | null;
  country: string | null;
}

/** Date/venue/location read off the infobox. Every field is optional upstream. */
export function pageMeta(html: string): PageMeta {
  const $ = cheerio.load(html);
  const fields = new Map<string, string>();

  $("table.infobox tr").each((_, tr) => {
    const label = $(tr).find("th").first().text().replace(/\s+/g, " ").trim().toLowerCase();
    const value = $(tr).find("td").first().text().replace(/\[\w+\]/g, "").replace(/\s+/g, " ").trim();
    if (label && value && !fields.has(label)) fields.set(label, value);
  });

  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = fields.get(k);
      if (v) return v;
    }
    return null;
  };

  const location = pick("location", "host city", "city");
  // "Belgrade, Serbia" / "Paris, France" — the tail is the country.
  const parts = location ? location.split(",").map((p) => p.trim()).filter(Boolean) : [];

  return {
    date: parseWikiDate(pick("date", "dates", "competition date") ?? ""),
    venue: pick("venue", "arena"),
    city: parts[0] ?? null,
    country: pick("country") ?? (parts.length > 1 ? parts[parts.length - 1] : null),
  };
}
