// Client calls for the Personal Library.
import { getClientId, type FeedVideo } from "./client";

export interface CollectionMeta { id: string; name: string; system: string | null; count: number; }
export interface LibraryItem { videoId: string; title: string; channel: string; channelId?: string; topic?: string | null; addedAt: number; }

const toInput = (v: FeedVideo) => ({ id: v.id, title: v.title, channel: v.channel, channelId: v.channelId, topic: v.topic ?? null });

export async function fetchLibrary(): Promise<{ collections: CollectionMeta[]; savedIds: string[] }> {
  try {
    const r = await fetch(`/api/feed/library?cid=${encodeURIComponent(getClientId())}`);
    return await r.json();
  } catch { return { collections: [], savedIds: [] }; }
}

export async function fetchCollection(id: string): Promise<{ collection: CollectionMeta; items: LibraryItem[] } | null> {
  try {
    const r = await fetch(`/api/feed/library/collection?cid=${encodeURIComponent(getClientId())}&id=${encodeURIComponent(id)}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function post(body: Record<string, unknown>) {
  return fetch("/api/feed/library", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ cid: getClientId(), ...body }),
  });
}

export const saveVideo = (v: FeedVideo, target?: { collectionId?: string; system?: string }) =>
  post({ action: "save", video: toInput(v), ...target });
export const unsaveVideo = (videoId: string, collectionId?: string) =>
  post({ action: "unsave", videoId, collectionId });
export const createCollection = async (name: string): Promise<CollectionMeta | null> => {
  const r = await post({ action: "create", name });
  const j = await r.json();
  return j.collection ?? null;
};
export const deleteCollection = (id: string) => post({ action: "deleteCollection", id });
