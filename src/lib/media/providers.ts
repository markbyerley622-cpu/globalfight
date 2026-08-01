// ════════════════════════════════════════════════════════════════════════
//  Image providers. Adding one is adding an entry here, not a new pipeline.
// ════════════════════════════════════════════════════════════════════════

import type { MediaProvider, MediaSubject } from "./types";

/**
 * ESPN athlete headshots.
 *
 * The URL is NOT guessed. ESPN's own athlete resource publishes
 * `headshot.href`, and it is exactly
 * `https://a.espncdn.com/i/headshots/mma/players/full/{athleteId}.png` — verified
 * against the API for a known athlete before this was written. The id we hold is
 * the same one ESPN put on the competitor, so this reproduces a URL the source
 * published rather than inventing a path and hoping.
 *
 * It 404s for lesser-known fighters. That is a recorded miss, not a failure.
 */
export const espnHeadshots: MediaProvider = {
  key: "espn",
  tier: "espn",
  label: "ESPN athlete headshots",
  candidateFor(subject: MediaSubject) {
    const id = subject.externalIds.espn;
    if (!id) return null;
    // Ids arrive as "espn:3093653" from the fight-stub provenance.
    const bare = id.startsWith("espn:") ? id.slice(5) : id;
    if (!/^\d+$/.test(bare)) return null;
    return {
      url: `https://a.espncdn.com/i/headshots/mma/players/full/${bare}.png`,
      tier: "espn",
      source: "espn",
    };
  },
};

/**
 * The registry. Ordered best-tier-first so the pipeline asks the strongest
 * source it has for a subject before falling back.
 *
 * Not yet present, and deliberately not stubbed:
 *   manual    — already handled by the upload path; it only has to be protected
 *               from being overwritten, which mayReplace() does.
 *   official  — needs a per-promotion licence position before any bytes are taken.
 *   wikimedia — the existing photoUrl/photoCredit/photoLicense path already
 *               carries Commons images WITH attribution; folding it in here means
 *               moving that licence metadata across, which is its own change.
 */
export const MEDIA_PROVIDERS: MediaProvider[] = [espnHeadshots];

export const providerFor = (key: string): MediaProvider | undefined =>
  MEDIA_PROVIDERS.find((p) => p.key === key);
