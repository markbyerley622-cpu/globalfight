// ── Card segments and bout timing ───────────────────────────────────────────
// A fight card is not a flat list — a fan thinks in blocks ("I'll catch the main
// card") and in times ("when is my guy on?"). This turns bout order into both.
//
// HONESTY RULE: broadcast blocks and walkout times are only FACTS when a
// provider gives them. Where we derive them, every surface must say "est.".
// Nothing here invents a time and presents it as scheduled.

export type SegmentKey = "MAIN" | "PRELIM" | "EARLY_PRELIM";

export interface SegmentMeta {
  key: SegmentKey;
  label: string;
  /** Minutes before the event's headline start time this block begins. */
  offsetMinutes: number;
}

export const SEGMENTS: Record<SegmentKey, SegmentMeta> = {
  EARLY_PRELIM: { key: "EARLY_PRELIM", label: "Early prelims", offsetMinutes: 240 },
  PRELIM: { key: "PRELIM", label: "Prelims", offsetMinutes: 120 },
  MAIN: { key: "MAIN", label: "Main card", offsetMinutes: 0 },
};

export const SEGMENT_ORDER: SegmentKey[] = ["EARLY_PRELIM", "PRELIM", "MAIN"];

/** The minimum a bout realistically occupies: fight time + walkouts + replay. */
export function boutMinutes(scheduledRounds: number): number {
  // 5-minute rounds are the common case; 3-minute boxing rounds run shorter but
  // carry more between-round time, so this lands close for both.
  return Math.round(scheduledRounds * 5 * 0.6) + 12;
}

export interface SegmentableFight {
  id: string;
  scheduledRounds: number;
  mainEvent: boolean;
  coMain: boolean;
  cardSegment?: string | null;
  cancelled?: boolean;
}

/**
 * Split a card into broadcast blocks.
 *
 * `fights` must already be in BILLING order (main event first — what orderFights
 * returns). Returns blocks in BROADCAST order (early prelims first), each with
 * its fights in the order they will actually happen.
 *
 * `derived` is true when no provider gave us blocks and we inferred the split —
 * callers must label the times as estimates in that case.
 */
export function segmentCard<T extends SegmentableFight>(
  fights: T[],
): { derived: boolean; blocks: { meta: SegmentMeta; fights: T[] }[] } {
  const provided = fights.some((f) => f.cardSegment);
  const by: Record<SegmentKey, T[]> = { EARLY_PRELIM: [], PRELIM: [], MAIN: [] };

  if (provided) {
    for (const f of fights) {
      const k = (f.cardSegment ?? "MAIN").toUpperCase() as SegmentKey;
      (by[k] ?? by.MAIN).push(f);
    }
  } else {
    // Derived split. A short card is ALL main card — inventing a "prelims" block
    // for a 5-bout show would be worse than showing none.
    const n = fights.length;
    const mainCount = n <= 6 ? n : Math.min(5, n);
    const prelimCount = n <= 6 ? 0 : Math.min(4, n - mainCount);
    fights.forEach((f, i) => {
      if (i < mainCount) by.MAIN.push(f);
      else if (i < mainCount + prelimCount) by.PRELIM.push(f);
      else by.EARLY_PRELIM.push(f);
    });
  }

  const blocks = SEGMENT_ORDER
    .filter((k) => by[k].length > 0)
    // Within a block, bouts run from the LEAST to the MOST significant — the
    // main event closes the show, so billing order is reversed for broadcast.
    .map((k) => ({ meta: SEGMENTS[k], fights: [...by[k]].reverse() }));

  return { derived: !provided, blocks };
}

/**
 * Estimated walkout time per bout, keyed by fight id.
 *
 * Anchors each block at `eventDate - offset`, then runs its bouts back to back.
 * Cancelled bouts occupy no time. This is an ESTIMATE and every caller renders
 * it as one.
 */
export function estimateBoutTimes<T extends SegmentableFight>(
  blocks: { meta: SegmentMeta; fights: T[] }[],
  eventDate: Date,
): Map<string, Date> {
  const out = new Map<string, Date>();
  for (const block of blocks) {
    let t = eventDate.getTime() - block.meta.offsetMinutes * 60_000;
    for (const f of block.fights) {
      if (f.cancelled) continue;
      out.set(f.id, new Date(t));
      t += boutMinutes(f.scheduledRounds) * 60_000;
    }
  }
  return out;
}

export type BoutProgress = "completed" | "current" | "upcoming" | "cancelled";

/**
 * Where a bout sits in the run of the night.
 *
 * "current" is the first undecided, uncancelled bout on a LIVE card — derived
 * from results, not from a live feed, so it is only claimed while the event is
 * actually flagged live.
 */
export function boutProgress(
  fight: { result: string; cancelled?: boolean },
  isCurrent: boolean,
): BoutProgress {
  if (fight.cancelled) return "cancelled";
  if (fight.result !== "SCHEDULED") return "completed";
  return isCurrent ? "current" : "upcoming";
}

/** The id of the bout happening now, or null when the card isn't live. */
export function currentBoutId<T extends SegmentableFight & { result: string }>(
  blocks: { fights: T[] }[],
  eventStatus: string,
): string | null {
  if (eventStatus !== "LIVE") return null;
  for (const b of blocks) {
    for (const f of b.fights) {
      if (!f.cancelled && f.result === "SCHEDULED") return f.id;
    }
  }
  return null;
}
