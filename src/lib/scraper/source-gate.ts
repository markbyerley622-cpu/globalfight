// ════════════════════════════════════════════════════════════════════════════
//  THE OUTBOUND COMPLIANCE BOUNDARY.
//
//  ── The defect this closes ────────────────────────────────────────────────
//  `isSourceEnabled()` in the ingestion registry gates PERSISTENCE. It is called
//  in exactly four places, all in runner.ts, all wrapping persistAggregated. So
//  for the entire history of this codebase `enabled: false` has meant
//
//      "fetch it, then throw the result away"
//
//  — never "do not fetch it". That is the wrong shape for a compliance control:
//  the objection to an unlicensed source is the REQUEST, not the row. Two
//  incidents made that concrete rather than theoretical:
//
//    • bkfc-news is `enabled: false` AND bkfc.com/robots.txt says
//      `Disallow: /news`, yet `mode: "daily"` queued up to 100 news pages.
//    • `backfill:bkfc --events --limit=3 --dry` made three live GETs to
//      xapi.mmareg.com on Render before printing "nothing written", because a
//      dry run skips the database, not the network.
//
//  ── What this does ────────────────────────────────────────────────────────
//  One check at the shared fetch boundary, so a connector cannot bypass it by
//  being new, by being a CLI script, by running under cron, or by being "just a
//  dry run". A source that is off is UNREACHABLE.
//
//  ── Enforcement, not activation ───────────────────────────────────────────
//  The rule is deliberately asymmetric, because the failure modes are not
//  symmetric: wrongly blocking a licensed source breaks ingestion loudly and
//  someone fixes it, while wrongly allowing an unlicensed one is silent and
//  is the thing we are trying to prevent. So:
//
//    host has a registered source that is ON      → ALLOW
//    host's registered sources are ALL OFF        → DENY
//    host is not registered at all                → ALLOW, and warn
//
//  The last line is the compromise that keeps this shippable. Several working
//  providers (ESPN, Wikipedia mirrors) reach hosts no registry entry names, and
//  denying unknown hosts would switch them off as a side effect of a hardening
//  change. Registering them is follow-up work; the warning is the to-do list.
//
//  A host whose only source is disabled is the case that actually matters, and
//  it is exactly the MMAReg case.
// ════════════════════════════════════════════════════════════════════════════

import { INGESTION_SOURCES } from "@/lib/ingestion-registry";
import { readFlags } from "@/lib/feature-flags";
import { log } from "./logger";

/** Thrown instead of making the request. Distinct so callers can tell a refusal
 *  apart from a network failure — one is a decision, the other is an outage. */
export class SourceDisabledError extends Error {
  readonly host: string;
  readonly sources: string[];
  constructor(host: string, sources: string[]) {
    super(
      `Refusing to fetch ${host}: every registered ingestion source for this host is disabled ` +
        `(${sources.join(", ")}). This is a compliance gate, not an outage — see ` +
        `src/lib/ingestion-registry.ts for the basis, and src/lib/scraper/source-gate.ts for how it is enforced.`,
    );
    this.name = "SourceDisabledError";
    this.host = host;
    this.sources = sources;
  }
}

/**
 * Feature flags that can veto a registry entry.
 *
 * A registry entry can be marked enabled while its flag is off, and the flag
 * must win — it is the operator's runtime control and the registry is a
 * document. Only sources with a genuine runtime switch appear here.
 */
const FLAG_OVERRIDES: Record<string, keyof ReturnType<typeof readFlags>> = {
  "bkfc-results": "bkfcResultsEnabled",
};

/** Is this source live right now — registry AND its flag, if it has one. */
export function effectiveEnabled(id: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const entry = INGESTION_SOURCES.find((s) => s.id === id);
  if (!entry || !entry.enabled) return false;
  const flag = FLAG_OVERRIDES[id];
  return flag ? readFlags(env)[flag] === true : true;
}

/**
 * Hostnames a registry entry declares.
 *
 * `host` is free text written for humans — "bkfc.com, youtube.com",
 * "~60 publisher feeds", "various governing bodies". Only tokens that actually
 * look like hostnames are used; prose contributes nothing and must not
 * accidentally match (a naive substring check on "various governing bodies"
 * would match nothing, but on a one-word entry it could match far too much).
 */
export function declaredHosts(hostField: string | null | undefined): string[] {
  if (!hostField) return [];
  return hostField
    .split(/[,\s]+/)
    .map((t) => t.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter((t) => /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(t));
}

/** A request's host matches a declared host, or a subdomain of one. */
function hostMatches(requestHost: string, declared: string): boolean {
  return requestHost === declared || requestHost.endsWith(`.${declared}`);
}

export interface GateDecision {
  allowed: boolean;
  host: string;
  /** Registered source ids that claim this host. */
  sources: string[];
  reason: "no-registered-source" | "source-enabled" | "all-sources-disabled" | "unparseable-url";
}

/** Decide whether an outbound request is permitted. Pure apart from env reads. */
export function gateDecision(url: string, env: NodeJS.ProcessEnv = process.env): GateDecision {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    // An unparseable URL cannot be attributed to a source. Let it through so the
    // fetch layer produces its own, clearer error rather than a compliance one.
    return { allowed: true, host: "", sources: [], reason: "unparseable-url" };
  }

  const claiming = INGESTION_SOURCES.filter((s) =>
    declaredHosts(s.host).some((d) => hostMatches(host, d)),
  );
  if (!claiming.length) return { allowed: true, host, sources: [], reason: "no-registered-source" };

  const live = claiming.filter((s) => effectiveEnabled(s.id, env));
  if (live.length) {
    return { allowed: true, host, sources: live.map((s) => s.id), reason: "source-enabled" };
  }
  return {
    allowed: false,
    host,
    sources: claiming.map((s) => s.id),
    reason: "all-sources-disabled",
  };
}

/**
 * Enforce the gate. Throws SourceDisabledError rather than returning, so a
 * caller that forgets to check cannot proceed by accident.
 *
 * Call this from the shared fetch layer — never from individual providers, or
 * the next connector will be written without it.
 */
export function assertFetchAllowed(url: string, env: NodeJS.ProcessEnv = process.env): void {
  const d = gateDecision(url, env);
  if (!d.allowed) throw new SourceDisabledError(d.host, d.sources);
  if (d.reason === "no-registered-source" && d.host) {
    // Not a failure — but every unregistered host is a source whose compliance
    // basis nobody has written down, so it should be visible rather than silent.
    log.warn({ host: d.host }, "source-gate:unregistered-host");
  }
}
