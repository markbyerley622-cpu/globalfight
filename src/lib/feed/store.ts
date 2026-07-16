// Persistent video catalog (JSON-backed, in-memory index). Decouples serving
// from live fetching: the ingestion job writes here; requests read this index.
// Node runtime only.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FeedVideo } from "./types";
import { dbEnabled, dbHydrateCatalog, dbPersistVideos } from "./repo";
import { flog } from "./log";

const MAX = 8000;

function dataFile(): string {
  const dir = process.env.FEED_DATA_DIR || join(process.cwd(), ".data");
  try { mkdirSync(dir, { recursive: true }); return join(dir, "feed-catalog.json"); }
  catch { return join(tmpdir(), "cr-feed-catalog.json"); }
}
const FILE = dataFile();

const byId = new Map<string, FeedVideo>();
let loaded = false;

export function load(): void {
  if (loaded) return;
  loaded = true;
  if (dbEnabled()) {
    // Postgres is the source of truth; hydrate the in-memory index (async so
    // reads stay synchronous — the index just fills in over the first moments).
    void dbHydrateCatalog(MAX).then((rows) => {
      for (const v of rows) if (!byId.has(v.id)) byId.set(v.id, v);
      if (rows.length) flog.info({ op: "store.hydrate", total: byId.size, source: "postgres" }, "catalog hydrated");
    });
    return;
  }
  try {
    const arr = JSON.parse(readFileSync(FILE, "utf8")) as FeedVideo[];
    for (const v of arr) byId.set(v.id, v);
    flog.info({ op: "store.load", total: byId.size, source: "json" }, "catalog loaded");
  } catch { /* first run */ }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function save(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const arr = [...byId.values()].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, MAX);
      if (arr.length < byId.size) { byId.clear(); for (const v of arr) byId.set(v.id, v); }
      writeFileSync(FILE, JSON.stringify(arr));
    } catch (e) { flog.error({ op: "store.save", err: (e as Error).message }, "catalog save failed"); }
  }, 400);
}

export function upsert(videos: FeedVideo[], now: number): number {
  const fresh: FeedVideo[] = [];
  for (const v of videos) {
    if (!v.id) continue;
    const existing = byId.get(v.id);
    if (existing) { if (v.viewCount != null) existing.viewCount = v.viewCount; continue; }
    const stored = { ...v, addedAt: now };
    byId.set(v.id, stored);
    fresh.push(stored);
  }
  if (fresh.length) {
    if (dbEnabled()) dbPersistVideos(fresh, now);
    else save();
  }
  return fresh.length;
}

export const all = (): FeedVideo[] => [...byId.values()];
export const size = (): number => byId.size;
export const findById = (id: string): FeedVideo | undefined => byId.get(id);
