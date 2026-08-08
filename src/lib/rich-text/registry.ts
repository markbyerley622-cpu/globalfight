import type { EntityHint, RichEntity } from "./types";

// ════════════════════════════════════════════════════════════════════════════
//  THE ENTITY REGISTRY — what a kind of entity IS, in one object.
//
//  ── The problem this replaces ─────────────────────────────────────────────
//  EntityText knew what a mention was. It read `entity.hint.username`, built
//  `/u/<username>`, and picked the colour. That is fine for exactly one kind and
//  becomes a switch the moment there are two — and then the same switch has to
//  be written again in the hover card, again in the prefetcher, again in the
//  notifier, and again in whatever links entities in a search result. Five
//  switches over the same union, each of which can be forgotten independently.
//  The failure is silent every time: a new kind renders as unstyled, unlinked
//  text and nobody notices, because nothing threw.
//
//  So the union is inverted. A kind is a PLUGIN — one object that answers every
//  question anybody can ask about that kind — and every consumer asks the
//  registry instead of branching. Adding a kind is adding a file. Nothing that
//  consumes entities is edited, which is the property being bought here; see
//  __tests__/registry-extensibility.test.ts, which enforces it.
//
//  ── What is deliberately NOT here ─────────────────────────────────────────
//  `render()`. A plugin says what a chip MEANS — its label, its tone, where it
//  points — and EntityText owns the one implementation of how a chip is built.
//  Letting plugins emit their own markup would put the focus ring, the hover
//  binding, the ARIA and the touch target in N places, which is the duplication
//  this file exists to prevent. Tone is a TOKEN, not class names, for the same
//  reason: the styling stays in one stylesheet.
//
//  Permission is likewise not decided here. `mayPreview` is a client-side
//  affordance — it stops the UI firing a request that is certain to 401 — and
//  is never the control. The preview endpoint re-derives what the viewer may
//  see, server-side, per CLAUDE.md rule 2.
//
//  PURE and client-safe: no prisma, no env, no React. Runtime-pure too — the
//  only React reference below is a type-only import, which erases at compile
//  time, so importing this from a server module pulls in no renderer.
// ════════════════════════════════════════════════════════════════════════════

/**
 * The visual family a kind belongs to.
 *
 * A token rather than class names so the palette lives in one place and a
 * plugin cannot invent a colour that exists nowhere else in the product.
 */
export type EntityTone = "person" | "fighter" | "event" | "place" | "org";

/** What a viewer is, as far as a client-side affordance decision needs to know. */
export interface ViewerHint {
  signedIn: boolean;
}

export interface EntityPlugin {
  /**
   * The stored discriminator. THIS is what makes a kind storable: entity kinds
   * are validated against the registry (see sanitizeEntities), so registering a
   * plugin is what teaches the whole pipeline the kind exists.
   */
  kind: string;

  /**
   * Singular noun for screen readers and analytics — "person", "event".
   * Used to build the accessible name of a chip, so it is read as
   * "Alex Pereira, person" rather than as an unexplained link.
   */
  label: string;

  /**
   * Plural, for a group heading in the composer's picker — "People",
   * "Fighters", "Events".
   *
   * A field rather than a pluralise() call: English plurals are irregular and
   * the picker is user-facing copy, so guessing would eventually print
   * "Promotions" correctly and something else badly. It is also the last thing
   * a new plugin needs before the picker can offer it — nothing in the picker
   * itself is edited.
   */
  labelPlural: string;

  tone: EntityTone;

  /**
   * How the picker draws this kind's mark when there is no image.
   *
   * ── Why a field and not `tone === "person"` ──────────────────────────────
   * The picker did infer it from the tone, and the inference was wrong in a way
   * worth recording: the tone token for fighters is literally `"fighter"`, so a
   * guard checking that the picker never names a kind could not tell a
   * presentation branch from a kind branch. Two different concepts sharing a
   * spelling is exactly how a "no per-kind logic" rule quietly stops being
   * checkable.
   *
   * So the plugin states it. `round` for anything depicting a HUMAN — a person,
   * a fighter — and `square` for a place, an event, an organisation, which is
   * the same convention the map pins and the preview cards already follow.
   */
  markShape: "round" | "square";

  /**
   * Where this entity points, or null when there is nothing to point at.
   *
   * Null is a real answer, not a failure: a deleted account, a hydrate that
   * found nothing, or a kind that has no page yet. The chip still renders —
   * the sentence was written around it — but as inert text rather than a link
   * to a URL that 404s.
   *
   * This is the ONLY definition of where a kind navigates. Deep linking, the
   * hover card's footer action and any future "open in a new tab" all read it.
   */
  href(entity: RichEntity): string | null;

  /** Tooltip when `href` returns null. Says why, in the reader's terms. */
  unavailable: string;

  /**
   * Whether this kind has a hover preview at all.
   *
   * A kind with no preview still renders and still navigates; it simply never
   * opens a card, and the hover machinery skips it without a request.
   */
  previewable: boolean;

  /**
   * Client-side affordance gate — may THIS viewer be shown a preview?
   *
   * Not a security control (see the header). Its job is to avoid firing a
   * request whose answer is already known to be a refusal, which on a feed full
   * of mentions is the difference between zero requests and one per chip for a
   * signed-out reader.
   *
   * Defaults to "anyone may try" when a plugin does not implement it.
   */
  mayPreview?(entity: RichEntity, viewer: ViewerHint): boolean;

  /**
   * Extra analytics dimensions for an interaction with this kind.
   *
   * Never include the raw id — see the note on data-* attributes in EntityText.
   * The kind and the tone are the interesting axes; who was hovered is not.
   */
  analytics?(entity: RichEntity): Record<string, string>;
}

// ── The registry itself ─────────────────────────────────────────────────────

const PLUGINS = new Map<string, EntityPlugin>();

/**
 * Register a kind.
 *
 * Idempotent per kind and LOUD on a genuine conflict. Module-level registration
 * runs once per kind under ESM, but a duplicate `kind` string across two plugin
 * files is a real bug — the second would silently win and one of the two files
 * would be dead code that still looks live.
 */
export function registerEntity(plugin: EntityPlugin): void {
  const existing = PLUGINS.get(plugin.kind);
  if (existing && existing !== plugin) {
    throw new Error(
      `Two entity plugins both claim kind "${plugin.kind}". A kind is its ` +
        "identity — rename one, or delete the duplicate.",
    );
  }
  PLUGINS.set(plugin.kind, plugin);
}

/** The plugin for a kind, or null when nothing has registered it. */
export function entityPlugin(kind: string): EntityPlugin | null {
  return PLUGINS.get(kind) ?? null;
}

/**
 * Every registered kind.
 *
 * This is what `sanitizeEntities` validates against, which is the mechanism
 * behind "a new plugin needs no core edits": the set of storable kinds is
 * derived from what is registered rather than restated as a literal that would
 * have to be kept in step.
 */
export function entityKinds(): string[] {
  return [...PLUGINS.keys()];
}

/** Every registered plugin. Used by the preview layer and by the tests. */
export function entityPlugins(): EntityPlugin[] {
  return [...PLUGINS.values()];
}

// ── Derived answers, so no consumer re-implements them ──────────────────────

/**
 * Where an entity navigates. Unknown kinds resolve to null rather than throwing.
 *
 * An unknown kind is not an exceptional condition: it is what a client running
 * yesterday's bundle sees when the server has started storing a kind that
 * bundle has never heard of. Rendering it as plain text is correct and is
 * exactly what happens to legacy content already.
 */
export function entityHref(entity: RichEntity): string | null {
  return entityPlugin(entity.type)?.href(entity) ?? null;
}

/**
 * Where a kind points, given only its routing hint.
 *
 * For callers that hold a LOADED row rather than a stored entity — chiefly the
 * preview cards, whose "Open" button had each rebuilt the URL its own plugin
 * already defines. Four cards, four copies of a route, and the day
 * `/fighters/<slug>` moves, three of them keep working and one 404s.
 *
 * `href()` only ever reads the hint, so this is the same answer by the same
 * code path — not a parallel one.
 */
export function entityHrefForHint(kind: string, hint: EntityHint): string | null {
  const plugin = entityPlugin(kind);
  if (!plugin) return null;
  return plugin.href({ type: kind, id: "", start: 0, end: 0, hint });
}

/** Whether a preview should even be attempted for this entity and viewer. */
export function entityPreviewable(entity: RichEntity, viewer: ViewerHint): boolean {
  const plugin = entityPlugin(entity.type);
  if (!plugin?.previewable) return false;
  return plugin.mayPreview ? plugin.mayPreview(entity, viewer) : true;
}

/**
 * The best name we can show for an entity WITHOUT its preview having loaded.
 *
 * ── Why this is one function and not an inline fallback chain ─────────────
 * Two surfaces need it (the card's heading and the host's aria-label) and both
 * were writing `hint.name ?? hint.username ?? …`. That expression is the exact
 * shape lib/__tests__/display-name-usage flags as the publicDisplayName bypass
 * — correctly, in general: `User.name` can be an email address, and falling
 * back from it to a handle is how an address ends up rendered to a stranger.
 *
 * It is safe HERE, and only here, because `hint.name` is not a raw User.name.
 * It is stamped by `resolveDraftEntities` on write and re-stamped by
 * `hydrateEntities` on read, both of which pass the row through
 * `publicDisplayName` first — so an email-shaped name has already become a
 * handle by the time it reaches this envelope. See lib/rich-text/resolve.
 *
 * Keeping it in one place means that guarantee is argued once, in one comment,
 * rather than re-argued at every call site — and if the stamping ever changes,
 * there is a single function to fix.
 */
export function entityDisplayName(entity: RichEntity, fallback = "Unknown"): string {
  const hint = entity.hint;
  return hint?.name || hint?.username || hint?.slug || fallback;
}

/**
 * The cache key for an entity's preview.
 *
 * `kind:id` and nothing else, which is what makes five mentions of the same
 * person on one screen collapse to a single request — see lib/rich-text/cache.
 */
export function entityCacheKey(entity: Pick<RichEntity, "type" | "id">): string {
  return `${entity.type}:${entity.id}`;
}
