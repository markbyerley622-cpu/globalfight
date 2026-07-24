import { resolvePromotion } from "@/lib/promotions";

// ════════════════════════════════════════════════════════════════════════
//  Watch + Ticket provider resolvers.
//
//  Most events arrive WITHOUT a per-event broadcaster/ticket URL, so the cards
//  said "TBA" everywhere. That doesn't scale — there are dozens of new events a
//  week. Instead we resolve, per PROMOTION, the primary place to watch and the
//  official ticketing home, and link there. Explicit per-event data (when the
//  feed supplies it) always wins over the promotion default.
//
//  Every entry below points at the promotion's OWN official destination — no
//  invented providers, no third-party deep links that could be regionally wrong.
//  The label names the primary broadcaster as a hint; the link goes to the
//  authoritative source where the exact, current per-event details live.
//  Region/PPV nuance is a known simplification (see docs/EVENT-EXPERIENCE.md).
// ════════════════════════════════════════════════════════════════════════

export interface ResolvedProvider {
  /** Short label shown on the pill, e.g. "ESPN+" or "Buy". */
  label: string;
  /** Destination URL (always an official source). */
  url: string;
  /** True when this came from explicit per-event data rather than the promotion default. */
  exact: boolean;
}

// Primary broadcaster + official watch destination, per promotion slug.
const WATCH_BY_PROMOTION: Record<string, { label: string; url: string }> = {
  ufc: { label: "ESPN+", url: "https://www.ufc.com/events" },
  "road-to-ufc": { label: "UFC Fight Pass", url: "https://ufcfightpass.com" },
  dwcs: { label: "ESPN+", url: "https://www.ufc.com/events" },
  one: { label: "Prime Video", url: "https://watch.onefc.com" },
  pfl: { label: "ESPN", url: "https://www.pflmma.com" },
  bellator: { label: "DAZN", url: "https://www.pflmma.com" },
  bkfc: { label: "BKFC App", url: "https://www.bkfc.com/events" },
  glory: { label: "DAZN", url: "https://glorykickboxing.com" },
  rizin: { label: "LIVENOW", url: "https://rizinff.com" },
  ksw: { label: "KSW TV", url: "https://kswmma.com" },
  "cage-warriors": { label: "UFC Fight Pass", url: "https://cagewarriors.com" },
  oktagon: { label: "Oktagon.tv", url: "https://oktagonmma.com" },
};

// Official ticketing home, per promotion slug.
const TICKETS_BY_PROMOTION: Record<string, { label: string; url: string }> = {
  ufc: { label: "UFC.com", url: "https://www.ufc.com/events" },
  "road-to-ufc": { label: "UFC.com", url: "https://www.ufc.com/events" },
  dwcs: { label: "UFC.com", url: "https://www.ufc.com/events" },
  one: { label: "ONE", url: "https://www.onefc.com/events" },
  pfl: { label: "PFL", url: "https://www.pflmma.com" },
  bellator: { label: "PFL", url: "https://www.pflmma.com" },
  bkfc: { label: "BKFC", url: "https://www.bkfc.com/events" },
  glory: { label: "GLORY", url: "https://glorykickboxing.com" },
  rizin: { label: "RIZIN", url: "https://rizinff.com" },
  ksw: { label: "KSW", url: "https://kswmma.com" },
  "cage-warriors": { label: "Cage Warriors", url: "https://cagewarriors.com" },
  oktagon: { label: "Oktagon", url: "https://oktagonmma.com" },
};

const isHttp = (u: string | null | undefined): u is string => !!u && /^https?:\/\//i.test(u);

/**
 * Where to watch this event. Explicit feed data (broadcaster name + event URL)
 * wins; otherwise the promotion's primary broadcaster + official watch page;
 * otherwise null → the card shows "TBA".
 */
export function resolveWatch(
  promotionRaw: string | null | undefined,
  broadcaster: string | null | undefined,
  eventUrl: string | null | undefined,
  eventName?: string | null,
): ResolvedProvider | null {
  if (broadcaster && isHttp(eventUrl)) return { label: broadcaster, url: eventUrl, exact: true };
  const slug = resolvePromotion(promotionRaw).slug;
  const def = WATCH_BY_PROMOTION[slug];
  if (def) return { ...def, exact: false };
  // Broadcaster known but no link: still name it (no navigation).
  if (broadcaster) return { label: broadcaster, url: "", exact: true };
  // Last resort — an honest search for how to watch, rather than a bare "TBA".
  // Labelled "Find stream" so it's clearly a lookup, not a promised broadcaster.
  if (eventName) return { label: "Find stream", url: searchUrl(`how to watch ${eventName} live stream`), exact: false };
  return null;
}

/**
 * Where to buy tickets. Explicit ticket URL wins ("Buy"); otherwise the
 * promotion's official ticketing home; otherwise null → "TBA".
 */
export function resolveTickets(
  promotionRaw: string | null | undefined,
  ticketUrl: string | null | undefined,
  eventName?: string | null,
): ResolvedProvider | null {
  if (isHttp(ticketUrl)) return { label: "Buy", url: ticketUrl, exact: true };
  const slug = resolvePromotion(promotionRaw).slug;
  const def = TICKETS_BY_PROMOTION[slug];
  if (def) return { ...def, exact: false };
  // Last resort — an honest ticket search rather than "TBA".
  if (eventName) return { label: "Find tickets", url: searchUrl(`${eventName} tickets`), exact: false };
  return null;
}

/** A neutral web search — used only as the final fallback for watch/tickets. */
function searchUrl(q: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}
