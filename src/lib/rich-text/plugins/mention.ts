import { registerEntity } from "../registry";

// ════════════════════════════════════════════════════════════════════════════
//  @mention — a person.
//
//  The only kind a composer authors today, and the one every rule in the entity
//  architecture was derived from. Routes on the CURRENT handle, which hydrate
//  refreshed from the stored id on read: that indirection is the entire reason
//  a rename no longer orphans historical content.
// ════════════════════════════════════════════════════════════════════════════

registerEntity({
  kind: "mention",
  labelPlural: "People",
  label: "person",
  markShape: "round",
  tone: "person",

  /**
   * `/u/<handle>`, using the handle refreshed on read.
   *
   * Null when there is no handle: a deleted account, or a hydrate that found
   * nothing. The words still render — the sentence was written around them —
   * because a link to `/u/undefined` is worse than no link.
   */
  href: (e) => (e.hint?.username ? `/u/${e.hint.username}` : null),
  unavailable: "This account is no longer available",

  /**
   * Public, and deliberately not gated on a session.
   *
   * A profile card shows what `/u/<handle>` already shows any visitor, so
   * `mayPreview` is left unimplemented — the registry's default is "anyone may
   * try", and writing `() => true` here would be a no-op that looked like a
   * decision. The fields that are NOT public — presence, last seen — are
   * removed by presenceDtoFor server-side, per that module's policy, rather
   * than by withholding the whole card from signed-out readers.
   */
  previewable: true,

  // Kind and tone only. The id is deliberately absent: see EntityText's note on
  // why primary keys do not go near the DOM or the analytics pipeline.
  analytics: () => ({ entity: "mention" }),
});
