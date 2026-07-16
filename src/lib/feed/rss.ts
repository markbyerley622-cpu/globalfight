// Parse YouTube channel RSS (zero quota) into normalized videos.
import { CHANNELS, channelUrl, type FeedChannel } from "./channels";
import type { FeedVideo, FeedTopic } from "./types";

const FETCH_TIMEOUT_MS = 8000;

function decodeEntities(str = ""): string {
  return String(str)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
const pick = (s: string, re: RegExp): string => { const m = re.exec(s); return m ? m[1] : ""; };

function parseFeed(xml: string, topic: FeedTopic): FeedVideo[] {
  const out: FeedVideo[] = [];
  const blocks = xml.split("<entry>").slice(1);
  for (const b of blocks) {
    const id = pick(b, /<yt:videoId>([^<]+)<\/yt:videoId>/);
    if (!id) continue;
    out.push({
      id,
      title: decodeEntities(pick(b, /<title>([\s\S]*?)<\/title>/)),
      channel: decodeEntities(pick(b, /<name>([^<]+)<\/name>/)),
      channelId: pick(b, /<yt:channelId>([^<]+)<\/yt:channelId>/) || undefined,
      description: decodeEntities(pick(b, /<media:description>([\s\S]*?)<\/media:description>/)).slice(0, 300),
      publishedAt: pick(b, /<published>([^<]+)<\/published>/),
      viewCount: Number(pick(b, /<media:statistics\s+views="(\d+)"/)) || undefined,
      topic,
    });
  }
  return out;
}

export interface RssResult { videos: FeedVideo[]; channelsOk: number; channelsTotal: number; }

// One channel, with an 8s timeout and a single retry — never let one slow or
// hung feed stall the whole ingest (Promise.allSettled isolates the rest).
async function fetchChannel(c: FeedChannel): Promise<FeedVideo[]> {
  const url = channelUrl(c);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "CombatRegister/1.0" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`RSS ${res.status} ${url}`);
      return parseFeed(await res.text(), c.topic);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchRss(): Promise<RssResult> {
  const results = await Promise.allSettled(CHANNELS.map(fetchChannel));
  const videos: FeedVideo[] = [];
  let ok = 0;
  for (const r of results) {
    if (r.status === "fulfilled") { videos.push(...r.value); ok++; }
    else console.error("[feed/rss]", (r.reason as Error).message);
  }
  return { videos, channelsOk: ok, channelsTotal: CHANNELS.length };
}
