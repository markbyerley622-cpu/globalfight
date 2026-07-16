// Ranking & selection over the catalog. Makes the feed feel endless: prioritize
// unseen, weave in variety, learn from engagement, and cycle back to classics
// (oldest-seen-first) so it never repeats immediately and never runs dry.
import { filterFeed } from "./filter";
import { smartScore } from "./tags";
import { MOCK_VIDEOS } from "./mock";
import * as store from "./store";
import { getUser, markServed, type UserState } from "./users";
import { ensureIngestion } from "./ingest";
import type { FeedVideo, SelectOptions } from "./types";

function candidates(): FeedVideo[] {
  ensureIngestion();
  const c = store.all();
  return c.length ? c : MOCK_VIDEOS;
}

function scoreFor(v: FeedVideo, u: UserState, now: number): number {
  let s = smartScore(v, now);
  if (v.tags) for (const t of v.tags) s += (u.weights[t] || 0) * 0.15;
  return s;
}

// Reduce runs of the same discipline AND same channel so the feed varies
// (MMA → Boxing → BJJ …, and no two clips from one channel back-to-back).
// findIndex keeps the earliest still-qualifying item, so score order is largely
// preserved — we only reach ahead when the next pick would repeat.
function diversify(list: FeedVideo[]): FeedVideo[] {
  const out: FeedVideo[] = [];
  const pending = [...list];
  let lastTopic: string | null | undefined = null;
  let lastCh: string | null | undefined = null;
  while (pending.length) {
    let idx = pending.findIndex((v) => v.topic !== lastTopic && v.channelId !== lastCh);
    if (idx === -1) idx = pending.findIndex((v) => v.topic !== lastTopic);
    if (idx === -1) idx = pending.findIndex((v) => v.channelId !== lastCh);
    if (idx === -1) idx = 0;
    const [v] = pending.splice(idx, 1);
    out.push(v);
    lastTopic = v.topic;
    lastCh = v.channelId;
  }
  return out;
}

// Opener rotation: for the very first batch of a session, lead with a *strong but
// varied* clip instead of always the #1 ranked one. Pick from the top handful,
// excluding whatever opened the last few sessions — ranked-but-rotating, never random-bad.
function rotateOpener(ordered: FeedVideo[], excludeOpeners?: string[]): void {
  if (ordered.length < 2) return;
  const exclude = new Set(excludeOpeners || []);
  const topK = ordered.slice(0, Math.min(8, ordered.length));
  const fresh = topK.filter((v) => !exclude.has(v.id));
  const choices = fresh.length ? fresh : topK;
  const pick = choices[Math.floor(Math.random() * choices.length)];
  const idx = ordered.indexOf(pick);
  if (idx > 0) { ordered.splice(idx, 1); ordered.unshift(pick); }
}

const visibleTo = (list: FeedVideo[], u: UserState): FeedVideo[] =>
  list.filter((v) => !u.notInterested.has(v.id) && !(v.channelId && u.hidden.has(v.channelId)));

export interface BatchResult { videos: FeedVideo[]; live: boolean; total: number; exhaustedUnseen: boolean; }

export function selectBatch(cid: string | undefined, opts: SelectOptions = {}): BatchResult {
  const now = Date.now();
  const u = getUser(cid);
  const limit = Math.min(Math.max(Number(opts.limit) || 12, 1), 40);
  const pool = visibleTo(filterFeed(candidates(), opts), u);

  const unseen = pool.filter((v) => !u.served.has(v.id));
  let ordered: FeedVideo[];
  if (unseen.length) {
    unseen.sort((a, b) => scoreFor(b, u, now) - scoreFor(a, u, now));
    ordered = diversify(unseen);
  } else {
    pool.sort((a, b) => (u.served.get(a.id) || 0) - (u.served.get(b.id) || 0));
    ordered = pool;
  }
  if (opts.opener) rotateOpener(ordered, opts.excludeOpeners);
  const picked = ordered.slice(0, limit);
  markServed(cid, picked.map((v) => v.id), now);
  return { videos: picked, live: store.size() > 0, total: store.size(), exhaustedUnseen: !unseen.length };
}

export interface ListResult { videos: FeedVideo[]; count: number; live: boolean; }

export function rankedList(cid: string | undefined, opts: SelectOptions = {}): ListResult {
  const now = Date.now();
  const u = getUser(cid);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const limit = Math.min(Math.max(Number(opts.limit) || 60, 1), 120);
  const pool = visibleTo(filterFeed(candidates(), opts), u);
  const sort = opts.sort || "smart";
  pool.sort((a, b) => {
    if (sort === "new") return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    if (sort === "top") return (b.viewCount || 0) - (a.viewCount || 0);
    const sa = scoreFor(a, u, now) - (u.served.has(a.id) ? 2 : 0);
    const sb = scoreFor(b, u, now) - (u.served.has(b.id) ? 2 : 0);
    return sb - sa;
  });
  return { videos: pool.slice(offset, offset + limit), count: pool.length, live: store.size() > 0 };
}
