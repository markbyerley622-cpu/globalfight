// ════════════════════════════════════════════════════════════════════════════
//  BKFC — the OFFICIAL RESULTS FEED.
//
//  ── What was actually wrong ───────────────────────────────────────────────
//  extract/events.ts and the provider README both stated that BKFC results are
//  unreadable:
//
//      "BKFC renders the per-bout winner via a client-side widget
//       (data-cond-key="RedResult"/…), and the static HTML contains all four
//       result variants unmarked — there is no server-rendered winner to read."
//
//  That is TRUE, and it was verified true rather than assumed: a completed card
//  really does ship all four variants (win / lose / draw / no contest) with none
//  marked, and `<p data-render="WinMethod">TBU</p>` as the placeholder. Unlike
//  the ONE case, the claim about the HTML was correct.
//
//  The mistake was the conclusion drawn from it. The widget's data source is not
//  private: the page declares it in plain sight, in its own inline script —
//
//      const FINAL_STATS = 'https://xapi.mmareg.com/api/bkfc?type=json&…&id=312';
//
//  — an unauthenticated GET that returns BKFC's official scored card. No
//  credentials, no session, no token; the same request any visitor's browser
//  makes to render the page.
//
//  ── Measured, over 24 events sampled across every slug family ─────────────
//      20  feed present → 207 bouts, 207 with a decided result
//       4  no feed URL  → ALL FOUR are future events (Sep–Nov 2026)
//
//      207/207 round + time + weight class + both athlete UUIDs
//      206/207 method (one bout genuinely states none)
//       12/207 championship bouts
//
//  So for completed events the feed is not a partial improvement — it is the
//  whole card, scored, with the referee and the ruleset named per bout.
//
//  ── Three response shapes, one normaliser ─────────────────────────────────
//  Discovered by measurement, not documentation:
//      v1  /api/bkfc?type=json      → Bouts is an ARRAY, every value a string
//      v2  /api/v2/bkfc/?type=json  → Bouts is an OBJECT keyed Bout1..BoutN,
//                                     values typed (BoutNumber is a number)
//      xml one page embeds type=xml → forced back to json by the URL normaliser
//  A parser that assumed the array shape silently read 11 of 20 events as empty.
//
//  ── Ordering ──────────────────────────────────────────────────────────────
//  BoutNumber ASCENDS from the first prelim, so the MAIN EVENT IS LAST — the
//  opposite of ONE. Verified against the event slug's own namesake on five
//  cards (BKFC 10 Lombard/Mundell = Bout 8 of 8; BKFC 2 Rawlings/Hart = 12 of
//  12; BKFC 3, 43, 45 likewise). We emit the card main-event-first so
//  `orderOnCard` matches every other provider.
// ════════════════════════════════════════════════════════════════════════════

import type { CheerioAPI } from "cheerio";
import type { BkfcBout, BkfcFeedBout, BkfcFeedCard, CardResult, Corner } from "./types";
import { clean, deriveWinnerCorner } from "./normalize";
import { normalizeText } from "@/lib/text/entities";

/** Hosts this module is willing to call. The feed URL comes from a third party's
 *  page, so it is treated as untrusted input and matched against an allow-list
 *  rather than fetched because it was found in HTML. */
const FEED_HOST = /^https:\/\/xapi\.mmareg\.com\//i;

/**
 * Pull the stats-feed URL out of an event page's inline script.
 *
 * FINAL_STATS is the settled card; LIVE_STATS is only populated while an event
 * is being logged live. Prefer the former, fall back to the latter, and return
 * null when both are empty — which is what an unannounced future event looks
 * like, and is not an error.
 */
export function extractStatsFeedUrl(html: string): string | null {
  const pick = (name: string): string | null => {
    const m = html.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`));
    const raw = m?.[1]?.trim();
    return raw ? raw : null;
  };
  const raw = pick("FINAL_STATS") ?? pick("LIVE_STATS");
  if (!raw) return null;

  // The page HTML-escapes the query separators (`&amp;`); a URL used verbatim
  // would carry a literal "amp;" into every parameter name after the first.
  const url = normalizeText(raw).replace(/&amp;/g, "&");
  if (!FEED_HOST.test(url)) return null;

  // Force JSON. One sampled page (BKFC 44) embeds type=xml, and the endpoint
  // honours it — that single character is the difference between a parsed card
  // and a payload this module cannot read.
  return url.replace(/type=xml/i, "type=json");
}

/** Read a feed value as a trimmed string, whatever the API typed it as. */
function s(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

function n(v: unknown): number | null {
  const t = s(v);
  if (!t) return null;
  const num = Number(t);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/**
 * Normalise either response shape into an ordered bout list.
 *
 * v2 keys the object `Bout1..BoutN`, which sorts WRONG as text ("Bout10" before
 * "Bout2"), so the numeric suffix is what orders it.
 */
export function normalizeFeedBouts(payload: unknown): BkfcFeedBout[] {
  if (!payload || typeof payload !== "object") return [];
  const bouts = (payload as { Bouts?: unknown }).Bouts;

  let raw: unknown[];
  if (Array.isArray(bouts)) raw = bouts;
  else if (bouts && typeof bouts === "object") {
    raw = Object.entries(bouts as Record<string, unknown>)
      .sort((a, b) => (Number(a[0].replace(/\D/g, "")) || 0) - (Number(b[0].replace(/\D/g, "")) || 0))
      .map(([, v]) => v);
  } else return [];

  const out: BkfcFeedBout[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, unknown>;
    const redFirst = clean(normalizeText(s(b.RedFirstName)));
    const redLast = clean(normalizeText(s(b.RedLastName)));
    const blueFirst = clean(normalizeText(s(b.BlueFirstName)));
    const blueLast = clean(normalizeText(s(b.BlueLastName)));
    // A bout needs two nameable people. Half a bout is worse than none.
    if ((!redFirst && !redLast) || (!blueFirst && !blueLast)) continue;

    out.push({
      boutNumber: n(b.BoutNumber) ?? out.length + 1,
      redFirstName: redFirst,
      redLastName: redLast,
      blueFirstName: blueFirst,
      blueLastName: blueLast,
      redNickname: clean(normalizeText(s(b.RedNickname))),
      blueNickname: clean(normalizeText(s(b.BlueNickname))),
      redUuid: clean(s(b.AthleteRedUUID)),
      blueUuid: clean(s(b.AthleteBlueUUID)),
      redResult: toCardResult(s(b.RedResult)),
      blueResult: toCardResult(s(b.BlueResult)),
      weightClass: clean(normalizeText(s(b.Weightclass))),
      boutRules: clean(normalizeText(s(b.BoutRules))),
      championship: s(b.ChampionshipBout) === "1",
      totalRounds: n(b.TotalRounds),
      winMethod: clean(normalizeText(s(b.WinMethod))),
      winTechnique: clean(normalizeText(s(b.WinTechnique))),
      roundEnded: n(b.RoundEnded),
      roundEndedTime: clean(s(b.RoundEndedTime)),
      referee: clean(normalizeText(s(b.Referee))),
    });
  }
  return out;
}

/** The feed's per-corner token → our vocabulary. Anything else is "unstated". */
function toCardResult(raw: string): CardResult | null {
  const t = raw.toLowerCase();
  if (t === "win") return "win";
  if (t === "lose" || t === "loss") return "lose";
  if (t === "draw") return "draw";
  if (t === "no contest" || t === "nocontest" || t === "nc") return "no contest";
  return null;
}

/** Event-level metadata the feed states, used to VERIFY identity before writing. */
export function parseFeedCard(payload: unknown): BkfcFeedCard | null {
  if (!payload || typeof payload !== "object") return null;
  const d = payload as Record<string, unknown>;
  const bouts = normalizeFeedBouts(payload);
  if (!bouts.length) return null;
  return {
    eventId: clean(s(d.EventID)),
    eventUuid: clean(s(d.EventUUID)),
    eventName: clean(normalizeText(s(d.EventName))),
    eventDate: clean(s(d.EventDate)),
    venue: clean(normalizeText(s(d.EventVenue))),
    country: clean(normalizeText(s(d.EventCountry))),
    complete: s(d.EventComplete) === "1",
    bouts,
  };
}

// ─── Corner identity ────────────────────────────────────────────────────────

/** Accent-stripped, punctuation-free token set. "O'Bannon" → {obannon}. */
function tokens(input: string | null): string[] {
  if (!input) return [];
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Apostrophes CLOSE UP ("O'Bannon" → "obannon") because that is how BKFC
    // slugs them. Every other separator opens a token boundary. Collapsing both
    // the same way would produce "o bannon" and match nothing.
    .replace(/['‘’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** slug → display name for every fighter linked on an event page's card. */
export function cardFighterIndex($: CheerioAPI): Map<string, string> {
  const index = new Map<string, string>();
  $('a[href*="/fighters/"]').each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(/\/fighters\/([a-z0-9-]+)/i);
    if (!m) return;
    const slug = m[1].toLowerCase();
    const name =
      clean(normalizeText($(a).find(".fight-card_name").first().text())) ??
      clean(normalizeText($(a).attr("aria-label") ?? "")) ??
      "";
    // First non-empty label wins; the responsive copies repeat the same anchor.
    if (!index.has(slug) || (!index.get(slug) && name)) index.set(slug, name);
  });
  return index;
}

/**
 * Resolve a feed athlete to the bkfc.com fighter slug the CARD links to.
 *
 * ── Why bother, when the feed has its own stable UUID ─────────────────────
 * Because they are different namespaces. The feed's AthleteRedUUID is MMAReg's
 * id; the DOM's data-red-fighter-uuid is a third, unrelated one (measured: zero
 * overlap). Every BKFC fighter we already hold was persisted under its bkfc.com
 * PAGE SLUG, so emitting a UUID as the external id would miss the existing row,
 * fall through to name matching, and risk minting a duplicate — the precise
 * failure this project has been bitten by before.
 *
 * The match is made inside ONE CARD's closed set of ~16–24 linked fighters,
 * which is what makes it safe: it requires every surname token and at least one
 * given-name token to be present, and it returns null unless exactly one
 * candidate survives.
 *
 * Measured over the 24-event sample: 376/414 corners resolved (90%), with
 * ZERO ambiguous matches — all 38 misses are fighters the page never linked
 * (late replacements, no BKFC profile). A miss emits no external id and lets the
 * shared dedupe engine resolve by name, exactly as the card-only path already did.
 */
export function resolveCornerSlug(
  firstName: string | null,
  lastName: string | null,
  index: Map<string, string>,
): string | null {
  const first = tokens(firstName);
  const last = tokens(lastName);
  if (!first.length && !last.length) return null;

  const candidates: string[] = [];
  for (const [slug, display] of index) {
    const have = new Set([...tokens(display), ...slug.split("-")]);
    if (last.length && !last.every((t) => have.has(t))) continue;
    if (first.length && !first.some((t) => have.has(t))) continue;
    candidates.push(slug);
  }
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    // A slug whose tokens are exactly the athlete's name beats a longer one that
    // merely contains them (a nickname slug, or a relative sharing a surname).
    const want = new Set([...first, ...last]);
    const exact = candidates.filter((c) => {
      const t = c.split("-");
      return t.length === want.size && t.every((x) => want.has(x));
    });
    if (exact.length === 1) return exact[0];
  }
  return null;
}

/**
 * The feed's card → our bout shape, main event FIRST.
 *
 * The feed supersedes the DOM card rather than merging with it: it carries every
 * field the DOM does plus the result, the ruleset, the scheduled rounds and the
 * referee, and merging two independently-ordered lists by name would introduce a
 * matching failure mode for no gain.
 */
export function feedCardToBouts(card: BkfcFeedCard, index: Map<string, string>): BkfcBout[] {
  const ordered = [...card.bouts].sort((a, b) => b.boutNumber - a.boutNumber);

  return ordered.map((b, i) => {
    const redName = clean([b.redFirstName, b.redLastName].filter(Boolean).join(" "));
    const blueName = clean([b.blueFirstName, b.blueLastName].filter(Boolean).join(" "));
    const winnerCorner: Corner | null = deriveWinnerCorner(b.redResult, b.blueResult);

    return {
      orderOnCard: i,
      redName: redName ?? "",
      blueName: blueName ?? "",
      redSlug: resolveCornerSlug(b.redFirstName, b.redLastName, index),
      blueSlug: resolveCornerSlug(b.blueFirstName, b.blueLastName, index),
      weightClass: b.weightClass,
      titleFight: b.championship,
      mainEvent: i === 0,
      coMain: i === 1,
      scheduledRounds: b.totalRounds,
      redResult: b.redResult,
      blueResult: b.blueResult,
      winnerCorner,
      // The published wording is kept verbatim; map.ts maps it to the enum.
      method: b.winMethod ?? b.winTechnique,
      roundEnded: b.roundEnded,
      timeEnded: b.roundEndedTime,
      ruleset: b.boutRules,
      referee: b.referee,
    };
  }).filter((b) => b.redName && b.blueName);
}

/**
 * Does this feed card actually describe THIS event?
 *
 * The feed URL is read off the event's own page, so the link is already strong
 * — but "already strong" is how a whole card gets attached to the wrong event
 * when a CMS copy-pastes a template. The feed states its own event name and
 * date, so that claim is checked rather than trusted.
 *
 * The DATE is the discriminator: BKFC reuses city names across years
 * ("BKFC Hollywood" exists more than once), so a name comparison alone would
 * accept a different edition of the same-named card. A one-day tolerance
 * absorbs timezone rendering — the feed writes local wall-clock ("Sat Feb 15
 * 2020") while we hold an instant.
 *
 * Returns a reason on rejection so a skip is reviewable rather than silent.
 */
export function verifyFeedCard(
  event: { date: string | null; name: string },
  card: BkfcFeedCard,
): { ok: true } | { ok: false; reason: string } {
  if (!card.bouts.length) return { ok: false, reason: "feed carries no bouts" };

  const ours = event.date ? Date.parse(event.date) : NaN;
  const theirs = card.eventDate ? Date.parse(card.eventDate) : NaN;

  // Neither side dated: fall back to the fact that this URL was published ON
  // the event's own page, which is still a direct 1:1 link.
  if (!Number.isFinite(ours) || !Number.isFinite(theirs)) return { ok: true };

  const dayMs = 86_400_000;
  const drift = Math.abs(ours - theirs);
  if (drift > dayMs * 1.5) {
    return {
      ok: false,
      reason: `date mismatch: ours ${new Date(ours).toISOString().slice(0, 10)} vs feed ${card.eventDate}`,
    };
  }
  return { ok: true };
}
