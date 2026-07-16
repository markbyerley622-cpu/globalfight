// ════════════════════════════════════════════════════════════════════════
//  Generic iCalendar (.ics) event adapter.
//
//  Governing bodies and promotions routinely publish their event calendar as a
//  public .ics feed — a structured, deterministic format (RFC 5545), unlike
//  scraping a rendered page. We parse VEVENTs into AdapterEvents. Works for any
//  discipline; the specific feed URL + sport are supplied by the registry.
// ════════════════════════════════════════════════════════════════════════

import { log } from "@/lib/scraper/logger";
import type { AdapterEvent, EventAdapter, SportEnum } from "./types";

const UA = "CombatRegisterBot/2.0 (+https://combat-register.vercel.app/bot)";
const TIMEOUT_MS = 8000;

/** Unfold RFC 5545 line folding: a line beginning with space/tab continues the previous. */
function unfold(ics: string): string[] {
  const raw = ics.split(/\r?\n/);
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Value of a property line like `DTSTART;TZID=...:20260718T190000` → the part after ':'. */
function propValue(line: string): string {
  const idx = line.indexOf(":");
  return idx === -1 ? "" : line.slice(idx + 1).trim();
}
function propName(line: string): string {
  const colon = line.indexOf(":");
  const semi = line.indexOf(";");
  const end = semi === -1 ? colon : Math.min(colon === -1 ? Infinity : colon, semi);
  return line.slice(0, end === Infinity ? undefined : end).toUpperCase();
}

/** Parse an ICS DTSTART value (date, floating datetime, or UTC "Z") to ISO. */
function icsDateToIso(v: string): string | null {
  // 20260718 | 20260718T190000 | 20260718T190000Z
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) {
    const d = new Date(v);
    return Number.isNaN(+d) ? null : d.toISOString();
  }
  const [, y, mo, da, hh = "00", mi = "00", ss = "00", z] = m;
  const iso = `${y}-${mo}-${da}T${hh}:${mi}:${ss}${z ? "Z" : "Z"}`; // treat floating as UTC
  const d = new Date(iso);
  return Number.isNaN(+d) ? null : d.toISOString();
}

const unescape = (s: string) => s.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();

export function parseIcs(ics: string, sport: SportEnum, promotion?: string): AdapterEvent[] {
  const lines = unfold(ics);
  const events: AdapterEvent[] = [];
  let cur: Record<string, string> | null = null;

  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) cur = {};
    else if (line.startsWith("END:VEVENT")) {
      if (cur) {
        const iso = cur.DTSTART ? icsDateToIso(cur.DTSTART) : null;
        const name = cur.SUMMARY ? unescape(cur.SUMMARY) : "";
        if (iso && name) {
          const loc = cur.LOCATION ? unescape(cur.LOCATION) : undefined;
          const parts = loc ? loc.split(",").map((p) => p.trim()).filter(Boolean) : [];
          events.push({
            externalId: cur.UID || `${name}-${iso.slice(0, 10)}`,
            name,
            sport,
            promotion,
            date: iso,
            venue: parts.length > 1 ? parts[0] : undefined,
            city: parts.length ? parts[parts.length > 1 ? 1 : 0] : undefined,
            country: parts.length > 2 ? parts[parts.length - 1] : undefined,
            url: cur.URL || undefined,
          });
        }
      }
      cur = null;
    } else if (cur) {
      const name = propName(line);
      if (["SUMMARY", "DTSTART", "LOCATION", "UID", "URL"].includes(name) && !cur[name]) {
        cur[name] = propValue(line);
      }
    }
  }
  return events;
}

/** Build an ICS-backed adapter for a sport + feed URL. */
export function icsAdapter(opts: { key: string; sport: SportEnum; label: string; url: string; promotion?: string }): EventAdapter {
  return {
    key: opts.key,
    sport: opts.sport,
    label: opts.label,
    async fetch(): Promise<AdapterEvent[]> {
      try {
        const res = await fetch(opts.url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) {
          log.warn({ adapter: opts.key, status: res.status }, "events:ics-fetch-failed");
          return [];
        }
        const text = await res.text();
        if (!text.includes("BEGIN:VCALENDAR")) {
          log.warn({ adapter: opts.key }, "events:ics-not-a-calendar");
          return [];
        }
        const now = Date.now();
        // Keep upcoming + very recent events only.
        const events = parseIcs(text, opts.sport, opts.promotion).filter((e) => +new Date(e.date) > now - 7 * 864e5);
        log.info({ adapter: opts.key, events: events.length }, "events:ics-parsed");
        return events;
      } catch (err) {
        log.warn({ adapter: opts.key, err: (err as Error).message }, "events:ics-error");
        return [];
      }
    },
  };
}
