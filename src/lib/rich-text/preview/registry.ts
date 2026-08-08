import "server-only";
import type { EntityPreview } from "../cache";

// ════════════════════════════════════════════════════════════════════════════
//  PREVIEW LOADERS — the server half of a plugin.
//
//  ── Why loaders are registered rather than switched on ────────────────────
//  The preview route receives a mixed batch: four mentions, an event and a gym,
//  in one request. Without a registry that route grows a switch over kinds and
//  becomes the fifth place a new entity has to be added. With one, the route is
//  a loop over "group by kind, call the loader" and never learns a kind's name.
//
//  ── The contract every loader owes ────────────────────────────────────────
//  1. ONE query per kind per request, not one per id. A batch of twelve
//     mentions is a single `findMany({ where: { id: { in: ids } } })`.
//  2. Return only PUBLIC fields, plus whatever the viewer is separately
//     entitled to. A loader is a read the client can aim at any id it can see
//     in a body, so it is treated as an open door and given nothing private.
//  3. Missing ids are simply ABSENT from the result. The cache reads that as
//     `missing` and stops asking. Never throw for one bad id in a batch of
//     twelve — that would lose eleven good answers.
//  4. Never leak existence. A row the viewer may not see is omitted exactly
//     like a row that does not exist, so the endpoint is not an oracle
//     (CLAUDE.md rule 6).
// ════════════════════════════════════════════════════════════════════════════

export interface LoaderContext {
  /** The signed-in viewer, or null. Loaders use it for viewer-scoped fields. */
  viewerId: string | null;
}

export type PreviewLoader = (
  ids: string[],
  ctx: LoaderContext,
) => Promise<EntityPreview[]>;

const LOADERS = new Map<string, PreviewLoader>();

export function registerPreviewLoader(kind: string, loader: PreviewLoader): void {
  const existing = LOADERS.get(kind);
  if (existing && existing !== loader) {
    throw new Error(`Two preview loaders registered for kind "${kind}".`);
  }
  LOADERS.set(kind, loader);
}

export function previewLoader(kind: string): PreviewLoader | null {
  return LOADERS.get(kind) ?? null;
}

