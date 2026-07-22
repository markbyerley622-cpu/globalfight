// ════════════════════════════════════════════════════════════════════════════
//  The trusted channel list — the ONLY place a YouTube channel id may appear.
//
//  Ingestion is allow-listed by design. There is no auto-discovery, no
//  user-supplied URL and no search: a video reaches this product because a
//  human put the channel that published it in this file. That is the whole
//  safety model, and it is why the embed path downstream can stay dumb.
//
//  TWO AXES, NOT ONE. The old shape had a single `topic`, which forced
//  "Bellator", "PFL" and "MMA Junkie" to all be tagged `ufc` — so filtering by
//  a promotion and filtering by a sport were the same broken control, and the
//  UFC filter returned Bellator. A channel now declares BOTH:
//
//    promotion   a slug from lib/promotions (ufc, one, bkfc, glory, …), or
//                null for independent media that covers many promotions
//    discipline  a slug from SPORT_PILLS (mma, boxing, muay-thai, …)
//
//  Both vocabularies already exist: `promotion` is exactly what FavoritePromotion
//  rows store, and `discipline` is exactly what the ?sport= pills use. Inventing
//  a third here would mean a channel could be "ufc" in a way that never matched
//  the UFC people actually follow.
//
//  Every channelId below was resolved from that channel's own page and verified
//  against its live RSS feed — see scripts/verify-feed-channels.mts.
// ════════════════════════════════════════════════════════════════════════════

export interface TrustedChannel {
  /** YouTube channel id (UC…). The RSS feed key. */
  channelId: string;
  /** @handle, so a human auditing this list can find the channel. Never fetched. */
  handle: string;
  /** The channel's own name, as its feed reports it. */
  name: string;
  /** Promotion slug from lib/promotions, or null for independent media. */
  promotion: string | null;
  /** Discipline slug — matches SPORT_PILLS, so it lines up with ?sport=. */
  discipline: string;
  /** Higher wins when several channels cover the same story. Official
   *  promotion channels outrank commentary. */
  priority: number;
  /** Flip to false to stop ingesting without losing the entry or its history. */
  active: boolean;
}

export const TRUSTED_CHANNELS: TrustedChannel[] = [
  // ── Official promotion channels ────────────────────────────────────────
  { channelId: "UCvgfXK4nTYKudb0rFR6noLA", handle: "UFC", name: "UFC", promotion: "ufc", discipline: "mma", priority: 100, active: true },
  { channelId: "UCiormkBf3jm6mfb7k0yPbKA", handle: "ONEChampionship", name: "ONE Championship", promotion: "one", discipline: "mma", priority: 100, active: true },
  { channelId: "UCEeMsInLdrUbIkbEcNm7g-A", handle: "bkfc", name: "Bare Knuckle Fighting Championship", promotion: "bkfc", discipline: "bare-knuckle", priority: 100, active: true },
  { channelId: "UCPrONRG9hO1f-OrxW-WH-xg", handle: "PFLMMA", name: "PFL MMA", promotion: "pfl", discipline: "mma", priority: 100, active: true },
  { channelId: "UCnkMTsKYqhHm6l6GQzg4szg", handle: "BellatorMMA", name: "BellatorMMA", promotion: "bellator", discipline: "mma", priority: 100, active: true },
  { channelId: "UCKj5FIgxeihLRLDpVqKp_aA", handle: "glory", name: "GLORY Kickboxing", promotion: "glory", discipline: "kickboxing", priority: 100, active: true },
  { channelId: "UCrx0XRJeIhstGD8H60kLYYA", handle: "KarateCombat", name: "Karate Combat", promotion: "karate-combat", discipline: "mma", priority: 100, active: true },
  { channelId: "UC4osr0nDXjyRZ18qINMPfmQ", handle: "ADCC", name: "adcc", promotion: "adcc", discipline: "bjj", priority: 100, active: true },
  { channelId: "UCbzRzJNHx7ZLlJML9BjZQVQ", handle: "toprank", name: "Top Rank Boxing", promotion: null, discipline: "boxing", priority: 90, active: true },
  { channelId: "UC7LReVje9aPB4B6XAsXX8WQ", handle: "MatchroomBoxing", name: "Matchroom Boxing", promotion: null, discipline: "boxing", priority: 90, active: true },

  // ── Independent media ──────────────────────────────────────────────────
  // promotion: null on purpose — these cover the whole sport, and tagging one
  // of them with a promotion would drop a Bellator breakdown into the UFC filter.
  { channelId: "UCxQfUu6vIJGZDODSwhr0m9w", handle: "MMAJunkie", name: "MMA Junkie", promotion: null, discipline: "mma", priority: 60, active: true },
  { channelId: "UCLoz0Yo1tP91ZUhe3CSTZIw", handle: "SevereMMA", name: "Severe MMA", promotion: null, discipline: "mma", priority: 50, active: true },
  { channelId: "UChUf04XP1CU_5llHA-0Ik5A", handle: "MiddleEasy", name: "MiddleEasy", promotion: null, discipline: "mma", priority: 50, active: true },
  { channelId: "UC789h3eqw0H1HqGmIsI26OA", handle: "TheMacLife", name: "TheMacLife", promotion: null, discipline: "mma", priority: 50, active: true },
  { channelId: "UCdl_gZZR6BtKi45eHFGAduw", handle: "iFLTV", name: "iFL TV", promotion: null, discipline: "boxing", priority: 50, active: true },
  { channelId: "UCAzXqFoW1Y7KDqwZ1x5m9EA", handle: "FightCommentaryBreakdowns", name: "Fight Commentary Breakdowns", promotion: null, discipline: "boxing", priority: 50, active: true },
  { channelId: "UCeOvhU6RbmEj8GKFiIMWxKQ", handle: "FloGrappling", name: "FloGrappling", promotion: null, discipline: "bjj", priority: 60, active: true },
  { channelId: "UCtXtqlLdZYZm3060qVExXkA", handle: "BernardoFariaBJJ", name: "Bernardo Faria BJJ", promotion: null, discipline: "bjj", priority: 50, active: true },
  { channelId: "UC0OFPvrlWV-FiAVIYjBHkQg", handle: "FloWrestling", name: "FloWrestling", promotion: null, discipline: "wrestling", priority: 60, active: true },
];

/** The channels ingestion should actually fetch. */
export const activeChannels = (): TrustedChannel[] => TRUSTED_CHANNELS.filter((c) => c.active);

const BY_ID = new Map(TRUSTED_CHANNELS.map((c) => [c.channelId, c]));
export const channelById = (id: string | null | undefined): TrustedChannel | undefined =>
  (id ? BY_ID.get(id) : undefined);

/**
 * The RSS feed URL. One form only.
 *
 * The legacy `?user=<name>` form was also supported; both channels that used it
 * have been resolved to real channel ids, so that branch is gone. One code path
 * is one thing to verify.
 */
export const channelUrl = (c: TrustedChannel): string =>
  `https://www.youtube.com/feeds/videos.xml?channel_id=${c.channelId}`;

/** Watch URL. Derived, never stored — a stored copy is a copy that can drift. */
export const watchUrl = (videoId: string): string => `https://www.youtube.com/watch?v=${videoId}`;

// A YouTube id is the only part of the URLs below that comes from parsed XML,
// so it is validated rather than interpolated blind.
const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

/**
 * Embed URL — ALWAYS youtube-nocookie, never youtube.com.
 *
 * Exported from here so no surface can accidentally embed the tracking host:
 * there is one function to grep for and one host in the codebase.
 */
export const embedUrl = (videoId: string): string | null =>
  (VIDEO_ID.test(videoId) ? `https://www.youtube-nocookie.com/embed/${videoId}` : null);

/** Thumbnail, also derived from the id — YouTube guarantees this path. */
export const thumbnailUrl = (videoId: string): string | null =>
  (VIDEO_ID.test(videoId) ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null);
