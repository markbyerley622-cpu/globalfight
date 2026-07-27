// ════════════════════════════════════════════════════════════════════════════
//  Evidence sources and how much we trust them. PURE data.
//
//  Reliability is NOT an opinion about journalism — it is a statement about how
//  structured and how corrigible a source is for the one question we ask it:
//  "who won, how, and in which round?"
//
//    · Wikipedia is slow but tabular and community-corrected, so a result there is
//      about as good as this pipeline can get without an official scorecard.
//    · An official promotion page is authoritative but often marketing-shaped.
//    · A wire/major outlet is fast and usually right, but a HEADLINE is written to
//      be read, not parsed — "chaotic ending" is not a method.
//    · An aggregator republishes others, so two aggregators agreeing is close to
//      ONE source agreeing with itself. That is why `independent` exists.
//
//  Nothing here decides anything on its own. These weights feed the confidence
//  engine, which is the only thing that scores a candidate.
// ════════════════════════════════════════════════════════════════════════════

export type SourceKind = "WIKIPEDIA" | "OFFICIAL" | "MAJOR" | "TRADE" | "AGGREGATOR" | "UNKNOWN";

export interface SourceProfile {
  kind: SourceKind;
  /** 0..1. How much one observation from this source is worth. */
  reliability: number;
  /**
   * Does this source do its own reporting?
   *
   * Aggregators and syndicators are marked false, and the confidence engine counts
   * all non-independent sources sharing a parent as ONE agreeing voice. Without
   * this, five sites republishing the same wire copy would look like five
   * independent confirmations of a rumour.
   */
  independent: boolean;
  /** Sources that syndicate from the same upstream share a group. */
  group?: string;
}

const PROFILES: Record<SourceKind, SourceProfile> = {
  WIKIPEDIA: { kind: "WIKIPEDIA", reliability: 0.95, independent: true },
  OFFICIAL: { kind: "OFFICIAL", reliability: 0.9, independent: true },
  MAJOR: { kind: "MAJOR", reliability: 0.75, independent: true },
  TRADE: { kind: "TRADE", reliability: 0.6, independent: true },
  AGGREGATOR: { kind: "AGGREGATOR", reliability: 0.35, independent: false, group: "aggregator" },
  UNKNOWN: { kind: "UNKNOWN", reliability: 0.25, independent: false, group: "unknown" },
};

/**
 * Hostname → kind. Suffix-matched, so subdomains and country editions resolve.
 *
 * An unlisted host is UNKNOWN, not MAJOR: a source we have never characterised must
 * not be able to push a candidate over an auto-publish threshold on its own. Adding
 * a source is one line, and that is a deliberate, reviewable act.
 */
const HOSTS: { suffix: string; kind: SourceKind }[] = [
  { suffix: "wikipedia.org", kind: "WIKIPEDIA" },

  // Official promotions.
  { suffix: "ufc.com", kind: "OFFICIAL" },
  { suffix: "onefc.com", kind: "OFFICIAL" },
  { suffix: "bkfc.com", kind: "OFFICIAL" },
  { suffix: "bellator.com", kind: "OFFICIAL" },
  { suffix: "matchroomboxing.com", kind: "OFFICIAL" },
  { suffix: "queensberrypromotions.com", kind: "OFFICIAL" },
  { suffix: "toprank.com", kind: "OFFICIAL" },
  { suffix: "goldenboypromotions.com", kind: "OFFICIAL" },
  { suffix: "pflmma.com", kind: "OFFICIAL" },
  { suffix: "adcc.com", kind: "OFFICIAL" },

  // Major outlets with dedicated combat-sports desks.
  { suffix: "espn.com", kind: "MAJOR" },
  { suffix: "bbc.co.uk", kind: "MAJOR" },
  { suffix: "bbc.com", kind: "MAJOR" },
  { suffix: "skysports.com", kind: "MAJOR" },
  { suffix: "dazn.com", kind: "MAJOR" },
  { suffix: "theguardian.com", kind: "MAJOR" },
  { suffix: "reuters.com", kind: "MAJOR" },
  { suffix: "apnews.com", kind: "MAJOR" },

  // Trade press — specialist, fast, generally accurate.
  { suffix: "mmafighting.com", kind: "TRADE" },
  { suffix: "mmajunkie.com", kind: "TRADE" },
  { suffix: "usatoday.com", kind: "TRADE" },
  { suffix: "sherdog.com", kind: "TRADE" },
  { suffix: "boxingscene.com", kind: "TRADE" },
  { suffix: "boxingnews24.com", kind: "TRADE" },
  { suffix: "ringtv.com", kind: "TRADE" },
  { suffix: "boxing247.com", kind: "TRADE" },
  { suffix: "eastsideboxing.com", kind: "TRADE" },
  { suffix: "bloodyelbow.com", kind: "TRADE" },
  { suffix: "tapology.com", kind: "TRADE" },

  // Aggregators / syndicators.
  { suffix: "news.google.com", kind: "AGGREGATOR" },
  { suffix: "msn.com", kind: "AGGREGATOR" },
  { suffix: "yahoo.com", kind: "AGGREGATOR" },
  { suffix: "flipboard.com", kind: "AGGREGATOR" },
];

/** The registered hostname for a URL, or null when it is not a usable URL. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function sourceKindFor(url: string | null | undefined): SourceKind {
  const host = hostOf(url);
  if (!host) return "UNKNOWN";
  const match = HOSTS.find((h) => host === h.suffix || host.endsWith(`.${h.suffix}`));
  return match?.kind ?? "UNKNOWN";
}

export function sourceProfileFor(url: string | null | undefined): SourceProfile {
  return PROFILES[sourceKindFor(url)];
}

export const profileOfKind = (kind: SourceKind): SourceProfile => PROFILES[kind];

/**
 * The identity used when counting AGREEING VOICES.
 *
 * Independent sources count individually (keyed by host, so two ESPN articles are
 * still one voice — a follow-up is not a second confirmation). Non-independent
 * sources collapse into their group, so a wall of aggregators counts once.
 */
export function voiceKey(url: string | null | undefined): string {
  const profile = sourceProfileFor(url);
  if (!profile.independent) return `group:${profile.group ?? profile.kind}`;
  return `host:${hostOf(url) ?? "unknown"}`;
}
