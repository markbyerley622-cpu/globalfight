// Parse YouTube channel RSS (zero quota, no API key) into normalized videos.
import { activeChannels, channelUrl, type TrustedChannel } from "./channels";
import type { FeedVideo } from "./types";
import { flog } from "./log";
// Shared, tested entity normalizer. The old inline decoder here had the same
// single-pass bug as news/ingest (double-encoded entities survived) AND used
// String.fromCharCode, which mangles astral code points — e.g. `&#128293;` (🔥)
// in a video title. decodeHtmlEntities/normalizeText fix both.
import { decodeHtmlEntities, normalizeText } from "@/lib/text/entities";

const FETCH_TIMEOUT_MS = 8000;

const pick = (s: string, re: RegExp): string => { const m = re.exec(s); return m ? m[1] : ""; };

// Descriptions render as TEXT, never HTML — but tags are stripped on the way IN
// as well. The safe thing to store is the thing that cannot be mistaken for
// markup later by a surface that forgets.
const stripTags = (s: string): string => s.replace(/<[^>]*>/g, "");

function parseFeed(xml: string, c: TrustedChannel): FeedVideo[] {
  const out: FeedVideo[] = [];
  const blocks = xml.split("<entry>").slice(1);
  for (const b of blocks) {
    const id = pick(b, /<yt:videoId>([^<]+)<\/yt:videoId>/);
    if (!id) continue;
    out.push({
      id,
      title: normalizeText(pick(b, /<title>([\s\S]*?)<\/title>/)),
      channel: normalizeText(pick(b, /<name>([^<]+)<\/name>/)) || c.name,
      // Taken from the TRUSTED entry, not from the payload: a feed body must not
      // be able to claim its videos belong to a different channel.
      channelId: c.channelId,
      description: normalizeText(stripTags(decodeHtmlEntities(pick(b, /<media:description>([\s\S]*?)<\/media:description>/)))).slice(0, 300),
      publishedAt: pick(b, /<published>([^<]+)<\/published>/),
      viewCount: Number(pick(b, /<media:statistics\s+views="(\d+)"/)) || undefined,
      promotion: c.promotion,
      discipline: c.discipline,
    });
  }
  return out;
}

export interface RssResult { videos: FeedVideo[]; channelsOk: number; channelsTotal: number; }

/**
 * One channel, with an 8s timeout and a single retry — one slow feed must never
 * stall the ingest (Promise.allSettled isolates the rest).
 *
 * NO CONDITIONAL GET. It was built here and then removed, because YouTube's RSS
 * server does not support it: the response carries no ETag and no Last-Modified,
 * and a request sent with either If-None-Match or If-Modified-Since is answered
 * 200 with a full body every time — measured against the live endpoint. All it
 * advertises is `Cache-Control: max-age=900`, and the ingest cron runs hourly,
 * so there is no repeat fetch inside that window to save. Keeping the machinery
 * would have meant a table, two queries per channel and a "notModified" counter
 * that could only ever report zero.
 */
async function fetchChannel(c: TrustedChannel): Promise<FeedVideo[]> {
  const url = channelUrl(c);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "CombatReviews/1.0 (+https://globalfight.onrender.com)" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`RSS ${res.status} ${c.handle}`);
      return parseFeed(await res.text(), c);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchRss(): Promise<RssResult> {
  const channels = activeChannels();
  const results = await Promise.allSettled(channels.map(fetchChannel));
  const videos: FeedVideo[] = [];
  let ok = 0;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      videos.push(...r.value);
      ok++;
    } else {
      flog.error(
        { op: "rss.channel", channel: channels[i].handle, err: (r.reason as Error).message },
        "channel feed failed",
      );
    }
  });
  return { videos, channelsOk: ok, channelsTotal: channels.length };
}
