import "server-only";

// ════════════════════════════════════════════════════════════════════════════
//  The write and read halves of the entity pipeline — now one line of imports.
//
//  ── What used to be here ──────────────────────────────────────────────────
//  A hand-written mention resolver and a hand-written mention hydrator, both of
//  which knew what a user was. That was correct while `mention` was the only
//  kind. The moment fighters and events became pickable it would have become
//  either a switch in this file or — worse, and this is the version that nearly
//  happened — a second pair of functions called resolveFighterMention and
//  resolveEventMention living beside it.
//
//  Both are now driven by the ENTITY SOURCE registry (lib/rich-text/server),
//  where one object per kind answers suggest, resolve, hydrate and preview. The
//  resolver no longer knows a kind's name, and a new kind adds one file.
//
//  This module remains as the import path every repo already uses, so the
//  change reached forum posts, DMs, gym posts and gym comments without touching
//  any of them.
// ════════════════════════════════════════════════════════════════════════════

export {
  resolveDraftEntities,
  hydrateEntities,
  hydrateOne,
  type DraftEntity,
} from "./server";
