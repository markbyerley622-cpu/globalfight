// Per-client feed state: view history, hidden channels, not-interested, learned
// interest weights. Keyed by an anonymous client id. JSON-persisted. Node only.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  dbEnabled, dbHydrateUser, dbPersistServed, dbPersistHidden, dbPersistNotInterested, dbPersistInterest,
} from "./repo";
import { flog } from "./log";
import { BoundedCache } from "./lru";

export interface UserState {
  served: Map<string, number>;
  hidden: Set<string>;
  notInterested: Set<string>;
  weights: Record<string, number>;
  hydrated?: boolean; // whether Postgres state has been loaded into this entry
}

// Bound the in-memory user cache so it can't grow without limit (durable state
// is in Postgres, so an evicted key simply re-hydrates on next access).
const MAX_USERS = Number(process.env.FEED_MAX_USERS) || 5000;
const USER_TTL_MS = Number(process.env.FEED_USER_TTL_MS) || 30 * 60 * 1000;

function dataFile(): string {
  const dir = process.env.FEED_DATA_DIR || join(process.cwd(), ".data");
  try { mkdirSync(dir, { recursive: true }); return join(dir, "feed-users.json"); }
  catch { return join(tmpdir(), "cr-feed-users.json"); }
}
const FILE = dataFile();

const users = new BoundedCache<UserState>(MAX_USERS, USER_TTL_MS);
let loaded = false;
let lastEvictLog = 0;

export function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const obj = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, {
      served?: Record<string, number>; hidden?: string[]; notInterested?: string[]; weights?: Record<string, number>;
    }>;
    for (const [cid, u] of Object.entries(obj)) {
      users.set(cid, {
        served: new Map(Object.entries(u.served || {})),
        hidden: new Set(u.hidden || []),
        notInterested: new Set(u.notInterested || []),
        weights: u.weights || {},
      });
    }
    flog.info({ op: "users.load", profiles: users.size }, "profiles loaded");
  } catch { /* first run */ }
}

let t: ReturnType<typeof setTimeout> | null = null;
export function save(): void {
  if (t) clearTimeout(t);
  t = setTimeout(() => {
    try {
      const obj: Record<string, unknown> = {};
      for (const [cid, u] of users.entries()) {
        const served = [...u.served.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4000);
        obj[cid] = {
          served: Object.fromEntries(served),
          hidden: [...u.hidden], notInterested: [...u.notInterested], weights: u.weights,
        };
      }
      writeFileSync(FILE, JSON.stringify(obj));
    } catch (e) { flog.error({ op: "users.save", err: (e as Error).message }, "users save failed"); }
  }, 500);
}

export function getUser(cid?: string): UserState {
  const key = cid || "anon";
  let u = users.get(key);
  if (!u) {
    u = { served: new Map(), hidden: new Set(), notInterested: new Set(), weights: {} };
    users.set(key, u);
    // surface eviction pressure periodically (evictions accrue as the cache fills)
    if (users.evictions - lastEvictLog >= 100) {
      lastEvictLog = users.evictions;
      flog.info({ op: "users.evict", evictions: users.evictions, size: users.size, max: MAX_USERS }, "feed user cache evicting");
    }
  }
  return u;
}

// Load a user's persisted state from Postgres into memory once per cache entry.
// The flag lives on the entry, so when the entry is evicted a later access
// re-hydrates from Postgres (lossless).
export async function hydrateUser(key: string): Promise<void> {
  if (!dbEnabled()) return;
  const u = getUser(key);
  if (u.hydrated) return;
  u.hydrated = true;
  const data = await dbHydrateUser(key);
  if (data.served) u.served = data.served;
  if (data.hidden) u.hidden = data.hidden;
  if (data.notInterested) u.notInterested = data.notInterested;
  if (data.weights) u.weights = data.weights;
}

export function markServed(cid: string | undefined, ids: string[], now: number): void {
  const key = cid || "anon";
  const u = getUser(key);
  for (const id of ids) u.served.set(id, now);
  if (dbEnabled()) dbPersistServed(key, ids, now); else save();
}
export function addSignal(cid: string | undefined, tags: string[] = [], amount = 1): void {
  const key = cid || "anon";
  const u = getUser(key);
  for (const tag of tags) u.weights[tag] = (u.weights[tag] || 0) + amount;
  if (dbEnabled()) tags.forEach((tag) => dbPersistInterest(key, tag, amount)); else save();
}
export function hideChannel(cid: string | undefined, channelId?: string): void {
  if (!channelId) return;
  const key = cid || "anon";
  getUser(key).hidden.add(channelId);
  if (dbEnabled()) dbPersistHidden(key, channelId); else save();
}
export function notInterested(cid: string | undefined, id?: string): void {
  if (!id) return;
  const key = cid || "anon";
  getUser(key).notInterested.add(id);
  if (dbEnabled()) dbPersistNotInterested(key, id); else save();
}
