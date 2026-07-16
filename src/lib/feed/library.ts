// Personal Library — Save / Watch Later / Favorites / Collections.
// Follows the feed's persistence pattern: Postgres when USE_MOCK_DATA is off,
// an in-memory fallback otherwise, every DB call wrapped so it never 500s.
import { prisma, USE_MOCK_DATA } from "@/lib/db";
import { flog } from "./log";
import { findById } from "./store";

export const SYSTEM = { WATCH_LATER: "watch_later", FAVORITES: "favorites" } as const;
export type SystemKind = (typeof SYSTEM)[keyof typeof SYSTEM];
const SYSTEM_NAME: Record<string, string> = { watch_later: "Watch Later", favorites: "Favorites" };

export interface CollectionMeta { id: string; name: string; system: string | null; count: number; }
export interface LibraryItem { videoId: string; title: string; channel: string; channelId?: string; topic?: string | null; addedAt: number; }
export interface SaveInput { id: string; title?: string; channel?: string; channelId?: string; topic?: string | null; }

const dbOn = () => !USE_MOCK_DATA;

// Resolve the video's snapshot fields from the catalog (authoritative) or the
// caller-supplied fields as a fallback.
function snapshot(v: SaveInput): Omit<LibraryItem, "addedAt"> {
  const cat = findById(v.id);
  return {
    videoId: v.id,
    title: (cat?.title ?? v.title ?? "").slice(0, 300),
    channel: (cat?.channel ?? v.channel ?? "").slice(0, 200),
    channelId: cat?.channelId ?? v.channelId,
    topic: cat?.topic ?? v.topic ?? null,
  };
}

// ───────────────────────── in-memory fallback (mock mode) ─────────────────────────
// Held on globalThis (like the Prisma singleton in @/lib/db) so all route-handler
// module instances share one store in dev and across HMR. Unused when dbOn().
interface MemColl { id: string; key: string; name: string; system: string | null; createdAt: number; items: Map<string, LibraryItem>; }
const g = globalThis as unknown as { __crFeedLibMem?: Map<string, MemColl>; __crFeedLibSeq?: { n: number } };
const mem = g.__crFeedLibMem ?? (g.__crFeedLibMem = new Map<string, MemColl>());
const seq = g.__crFeedLibSeq ?? (g.__crFeedLibSeq = { n: 1 });

function memCollsFor(key: string): MemColl[] {
  return [...mem.values()].filter((c) => c.key === key);
}
function memEnsureSystem(key: string, system: SystemKind): MemColl {
  let c = memCollsFor(key).find((x) => x.system === system);
  if (!c) { c = { id: `m${seq.n++}`, key, name: SYSTEM_NAME[system], system, createdAt: Date.now(), items: new Map() }; mem.set(c.id, c); }
  return c;
}

// ───────────────────────── public API ─────────────────────────
export async function listLibrary(key: string): Promise<{ collections: CollectionMeta[]; savedIds: string[] }> {
  if (!dbOn()) {
    // always surface the two system collections, even when empty
    memEnsureSystem(key, SYSTEM.FAVORITES); memEnsureSystem(key, SYSTEM.WATCH_LATER);
    const colls = memCollsFor(key).sort((a, b) => rankColl(a.system) - rankColl(b.system) || a.createdAt - b.createdAt);
    const savedIds = new Set<string>();
    for (const c of colls) for (const id of c.items.keys()) savedIds.add(id);
    return { collections: colls.map((c) => ({ id: c.id, name: c.name, system: c.system, count: c.items.size })), savedIds: [...savedIds] };
  }
  try {
    await ensureSystemDb(key, SYSTEM.FAVORITES); await ensureSystemDb(key, SYSTEM.WATCH_LATER);
    const rows = await prisma.feedCollection.findMany({
      where: { key }, include: { _count: { select: { items: true } } }, orderBy: { createdAt: "asc" },
    });
    const saved = await prisma.feedCollectionItem.findMany({ where: { collection: { key } }, select: { videoId: true }, distinct: ["videoId"] });
    const collections = rows
      .map((r) => ({ id: r.id, name: r.name, system: r.system, count: r._count.items }))
      .sort((a, b) => rankColl(a.system) - rankColl(b.system));
    return { collections, savedIds: saved.map((s) => s.videoId) };
  } catch (e) {
    flog.error({ op: "library.list", err: (e as Error).message }, "list library failed");
    return { collections: [], savedIds: [] };
  }
}

export async function getCollectionItems(key: string, id: string): Promise<{ collection: CollectionMeta; items: LibraryItem[] } | null> {
  if (!dbOn()) {
    const c = mem.get(id);
    if (!c || c.key !== key) return null;
    const items = [...c.items.values()].sort((a, b) => b.addedAt - a.addedAt);
    return { collection: { id: c.id, name: c.name, system: c.system, count: items.length }, items };
  }
  try {
    const c = await prisma.feedCollection.findFirst({ where: { id, key }, include: { items: { orderBy: { addedAt: "desc" } } } });
    if (!c) return null;
    return {
      collection: { id: c.id, name: c.name, system: c.system, count: c.items.length },
      items: c.items.map((i) => ({ videoId: i.videoId, title: i.title, channel: i.channel, channelId: i.channelId ?? undefined, topic: i.topic, addedAt: i.addedAt.getTime() })),
    };
  } catch (e) {
    flog.error({ op: "library.get", err: (e as Error).message }, "get collection failed");
    return null;
  }
}

export async function saveVideo(key: string, video: SaveInput, target?: { collectionId?: string; system?: SystemKind }): Promise<{ collectionId: string }> {
  const snap = snapshot(video);
  if (!dbOn()) {
    const coll = target?.collectionId ? mem.get(target.collectionId) : memEnsureSystem(key, target?.system ?? SYSTEM.FAVORITES);
    if (!coll || coll.key !== key) throw new Error("collection not found");
    coll.items.set(snap.videoId, { ...snap, addedAt: Date.now() });
    return { collectionId: coll.id };
  }
  try {
    const collectionId = target?.collectionId ?? (await ensureSystemDb(key, target?.system ?? SYSTEM.FAVORITES));
    // guard: the target collection must belong to this key
    const owns = await prisma.feedCollection.findFirst({ where: { id: collectionId, key }, select: { id: true } });
    if (!owns) throw new Error("collection not found");
    await prisma.feedCollectionItem.upsert({
      where: { collectionId_videoId: { collectionId, videoId: snap.videoId } },
      create: { collectionId, ...snap, channelId: snap.channelId ?? null, topic: snap.topic ?? null },
      update: {},
    });
    return { collectionId };
  } catch (e) {
    flog.error({ op: "library.save", err: (e as Error).message }, "save failed");
    throw e;
  }
}

export async function unsaveVideo(key: string, videoId: string, collectionId?: string): Promise<void> {
  if (!dbOn()) {
    const targets = collectionId ? [mem.get(collectionId)].filter(Boolean) as MemColl[] : memCollsFor(key);
    for (const c of targets) if (c.key === key) c.items.delete(videoId);
    return;
  }
  try {
    if (collectionId) {
      await prisma.feedCollectionItem.deleteMany({ where: { videoId, collectionId, collection: { key } } });
    } else {
      await prisma.feedCollectionItem.deleteMany({ where: { videoId, collection: { key } } });
    }
  } catch (e) {
    flog.error({ op: "library.unsave", err: (e as Error).message }, "unsave failed");
  }
}

export async function createCollection(key: string, name: string): Promise<CollectionMeta> {
  const clean = name.trim().slice(0, 60) || "Untitled";
  if (!dbOn()) {
    const c: MemColl = { id: `m${seq.n++}`, key, name: clean, system: null, createdAt: Date.now(), items: new Map() };
    mem.set(c.id, c);
    return { id: c.id, name: c.name, system: null, count: 0 };
  }
  const c = await prisma.feedCollection.create({ data: { key, name: clean, system: null } });
  return { id: c.id, name: c.name, system: null, count: 0 };
}

export async function deleteCollection(key: string, id: string): Promise<void> {
  if (!dbOn()) {
    const c = mem.get(id);
    if (c && c.key === key && c.system === null) mem.delete(id);
    return;
  }
  try {
    await prisma.feedCollection.deleteMany({ where: { id, key, system: null } }); // system collections aren't deletable
  } catch (e) {
    flog.error({ op: "library.deleteCollection", err: (e as Error).message }, "delete collection failed");
  }
}

// ── helpers ──
function rankColl(system: string | null): number {
  if (system === SYSTEM.FAVORITES) return 0;
  if (system === SYSTEM.WATCH_LATER) return 1;
  return 2;
}
async function ensureSystemDb(key: string, system: SystemKind): Promise<string> {
  const c = await prisma.feedCollection.upsert({
    where: { key_system: { key, system } },
    create: { key, system, name: SYSTEM_NAME[system] },
    update: {},
  });
  return c.id;
}
