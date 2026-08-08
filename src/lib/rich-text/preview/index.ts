import "server-only";
import type { EntityPreview } from "../cache";
import { previewLoader, type LoaderContext } from "./registry";

// ── The loader manifest ─────────────────────────────────────────────────────
//  Same contract as the other two manifests: importing a file registers it, and
//  a test fails if a file in this directory is missing here.
import "./mention";
import "./fighter";
import "./event";
import "./gym";
import "./promotion";

export { registerPreviewLoader, type LoaderContext } from "./registry";

// ════════════════════════════════════════════════════════════════════════════
//  Loading a MIXED batch.
//
//  The route hands over whatever the client asked for — four mentions, an event
//  and a gym — and gets back a flat list. Kinds are grouped and each loader is
//  called ONCE with all of its ids, so a batch of twelve entities across three
//  kinds is three queries, not twelve.
//
//  Kinds run CONCURRENTLY. They are independent reads against different tables,
//  and doing them in sequence would make the slowest one the floor for a hover
//  card's latency.
// ════════════════════════════════════════════════════════════════════════════

export interface PreviewRequest {
  type: string;
  id: string;
}

export async function loadPreviews(
  requested: PreviewRequest[],
  ctx: LoaderContext,
): Promise<EntityPreview[]> {
  const byKind = new Map<string, Set<string>>();
  for (const r of requested) {
    // An unregistered kind is skipped silently. It is what an older server sees
    // from a newer client, and refusing the whole batch over one unknown kind
    // would lose the answers it could have given.
    if (!previewLoader(r.type)) continue;
    const ids = byKind.get(r.type) ?? new Set<string>();
    ids.add(r.id);
    byKind.set(r.type, ids);
  }
  if (byKind.size === 0) return [];

  const results = await Promise.all(
    [...byKind].map(async ([kind, ids]) => {
      const loader = previewLoader(kind);
      if (!loader) return [];
      try {
        return await loader([...ids], ctx);
      } catch {
        // One kind failing must not take the batch down: the mentions in a body
        // still preview even if the event loader hit a bad row. The absent
        // kind is cached as `missing`, which the card renders honestly.
        return [];
      }
    }),
  );

  return results.flat();
}
