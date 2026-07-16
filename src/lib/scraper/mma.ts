// ════════════════════════════════════════════════════════════════════════
//  MMA roster scraper — current UFC fighters (Wikipedia).
//
//  Wikipedia's "List of current UFC fighters" renders one sortable wikitable
//  per division with columns: ISO | Name | Age | Ht. | Nickname | Status |
//  Ref | Endeavor record | MMA record. We pull name, country, nickname, MMA
//  record and height. Plain-fetch friendly (no Cloudflare) — set
//  SCRAPER_TRANSPORT=fetch. Regional / smaller-promotion fighters come from
//  the mmareg API (see ./mmareg), not from here.
// ════════════════════════════════════════════════════════════════════════

import * as cheerio from "cheerio";
import { fetchPage } from "./http";

const WIKI_URL =
  process.env.MMA_ROSTER_URL ?? "https://en.wikipedia.org/wiki/List_of_current_UFC_fighters";

export interface ScrapedMmaFighter {
  name: string;
  nickname?: string;
  nationality?: string;
  countryCode?: string;
  heightCm?: number;
  record: { wins: number; losses: number; draws: number };
}

// Full country name → ISO-3166 alpha-2 for the flags the UI renders. Common
// MMA nations; anything unmapped just renders without a flag.
const COUNTRY_CODE: Record<string, string> = {
  "United States": "US", Brazil: "BR", Russia: "RU", "United Kingdom": "GB",
  England: "GB", Scotland: "GB", Wales: "GB", Ireland: "IE", Canada: "CA",
  Mexico: "MX", Australia: "AU", "New Zealand": "NZ", France: "FR", Germany: "DE",
  Poland: "PL", Sweden: "SE", Netherlands: "NL", Spain: "ES", Italy: "IT",
  Georgia: "GE", Armenia: "AM", Kazakhstan: "KZ", Kyrgyzstan: "KG", Dagestan: "RU",
  China: "CN", Japan: "JP", "South Korea": "KR", Thailand: "TH", Philippines: "PH",
  "United Arab Emirates": "AE", "South Africa": "ZA", Nigeria: "NG", Cameroon: "CM",
  Argentina: "AR", Chile: "CL", Peru: "PE", Ecuador: "EC", Cuba: "CU",
  "Czech Republic": "CZ", Czechia: "CZ", Croatia: "HR", Serbia: "RS", Norway: "NO",
  Denmark: "DK", Finland: "FI", Austria: "AT", Switzerland: "CH", Belgium: "BE",
  Portugal: "PT", Ukraine: "UA", Belarus: "BY", Moldova: "MD", Romania: "RO",
  Bulgaria: "BG", Turkey: "TR", Iran: "IR", India: "IN", Indonesia: "ID",
  Singapore: "SG", Suriname: "SR", Jamaica: "JM", Venezuela: "VE", Colombia: "CO",
};

const parseRecord = (s: string): { wins: number; losses: number; draws: number } => {
  // "29–23 (1 NC)" / "15–20–1" — en-dash or hyphen separated, ignore (… NC).
  const parts = s.replace(/\(.*?\)/g, "").trim().split(/[–-]/).map((x) => parseInt(x.trim(), 10));
  return { wins: parts[0] || 0, losses: parts[1] || 0, draws: parts[2] || 0 };
};

const parseHeightCm = (s: string): number | undefined => {
  const m = s.match(/\(([\d.]+)\s*m\)/); // "5 ft 9 in (1.75 m)"
  return m ? Math.round(parseFloat(m[1]) * 100) : undefined;
};

/** Parse the Wikipedia roster page into fighter rows. Defensive per-row. */
export function parseUfcRoster(html: string): ScrapedMmaFighter[] {
  const $ = cheerio.load(html);
  const out: ScrapedMmaFighter[] = [];
  const seen = new Set<string>();

  $("table.wikitable.sortable").each((_, table) => {
    const $t = $(table);
    const headers = $t.find("tr").first().find("th").map((__, e) => $(e).text().trim()).get();
    // Roster tables have both "MMA record" and "Ht."; skip departures/other tables.
    if (!(headers.includes("MMA record") && headers.includes("Ht."))) return;
    const recCol = headers.lastIndexOf("MMA record");

    $t.find("tr").slice(1).each((__, tr) => {
      const td = $(tr).find("td");
      if (td.length < recCol + 1) return;

      const nationality = $(td[0]).find("img").attr("alt")?.trim() || undefined;
      const name = $(td[1]).text().trim().replace(/\(c\)/g, "").replace(/\[.*?\]/g, "").trim();
      if (!name || seen.has(name)) return;
      const nickname = $(td[4]).text().trim() || undefined;
      const record = parseRecord($(td[recCol]).text());
      const heightCm = parseHeightCm($(td[3]).text());

      seen.add(name);
      out.push({
        name,
        nickname,
        nationality,
        countryCode: nationality ? COUNTRY_CODE[nationality] : undefined,
        heightCm,
        record,
      });
    });
  });

  return out;
}

/** Fetch + parse the current UFC roster. */
export async function scrapeUfcRoster(): Promise<ScrapedMmaFighter[]> {
  const { html } = await fetchPage(WIKI_URL);
  return parseUfcRoster(html);
}
