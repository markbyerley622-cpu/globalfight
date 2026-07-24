// ════════════════════════════════════════════════════════════════════════
//  Feature flags — FAIL CLOSED, without exception.
//
//  Every flag here guards functionality that is unlicensed, unverified, or
//  legally ambiguous. The rule is absolute:
//
//      unset      → DISABLED
//      malformed  → DISABLED
//      "false"    → DISABLED
//      "true"     → enabled
//
//  Anything other than the exact string "true" is off. This is deliberate: the
//  previous implementation used `process.env.X !== "off"`, which meant an unset
//  variable ENABLED the feature. Kalshi and Polymarket were live in production
//  because nobody had set a variable nobody knew existed.
//
//  A flag being on is never sufficient on its own — the server routes enforce it
//  too. Hiding a UI control is not a control.
// ════════════════════════════════════════════════════════════════════════

/** The only accepted truthy value. Everything else is off. */
function on(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return env[name] === "true";
}

export interface FeatureFlags {
  /** Public-launch profile. Makes the production preflight strictest. */
  publicLaunchMode: boolean;

  // ── Prediction markets / gambling ──────────────────────────────────────
  /** Ingest Kalshi market data. Their terms forbid caching + third-party display. */
  kalshiEnabled: boolean;
  /** Ingest Polymarket data. Their ToS bars commercial use + public display. */
  polymarketEnabled: boolean;
  /** Render any market price anywhere in the UI or API. */
  marketPricesEnabled: boolean;
  /** Emit outbound links to a prediction-market / trading venue. */
  tradingLinksEnabled: boolean;

  // ── Data provenance ────────────────────────────────────────────────────
  /** Serve the rankings routes. Off until an approved, licensed source exists. */
  rankingsEnabled: boolean;
  /**
   * Master switch for AUTOMATED ranking ingestion (the connector cron). Off by
   * default. A source is fetched only when THIS is on AND that source is both
   * `licensed` and `connectorReady` in the registry — two locks, so enabling one
   * source for testing can't silently scrape every source. BoxRec is blocked in
   * code regardless of any flag.
   */
  rankingsIngestEnabled: boolean;
  /** Allow automated download/re-hosting of third-party media. */
  mediaIngestionEnabled: boolean;

  // ── User-generated content ─────────────────────────────────────────────
  /** Accept user media uploads (clips, forum attachments, avatars). */
  ugcMediaUploadsEnabled: boolean;

  // ── AI ─────────────────────────────────────────────────────────────────
  /** Voice-to-profile. Sends user audio to third-party processors. */
  voicebuildEnabled: boolean;
}

export function readFlags(env: NodeJS.ProcessEnv = process.env): FeatureFlags {
  return {
    publicLaunchMode: on("PUBLIC_LAUNCH_MODE", env),

    kalshiEnabled: on("KALSHI_ENABLED", env),
    polymarketEnabled: on("POLYMARKET_ENABLED", env),
    marketPricesEnabled: on("MARKET_PRICES_ENABLED", env),
    tradingLinksEnabled: on("TRADING_LINKS_ENABLED", env),

    rankingsEnabled: on("RANKINGS_ENABLED", env),
    rankingsIngestEnabled: on("RANKINGS_INGEST_ENABLED", env),
    mediaIngestionEnabled: on("MEDIA_INGESTION_ENABLED", env),

    ugcMediaUploadsEnabled: on("UGC_MEDIA_UPLOADS_ENABLED", env),

    voicebuildEnabled: on("VOICEBUILD_ENABLED", env),
  };
}

export const flags = (): FeatureFlags => readFlags();

/**
 * Market data may only be fetched or shown when the *specific* provider is on
 * AND the umbrella market-prices flag is on. Two locks, because enabling a
 * provider for a back-office task must not silently publish prices to the world.
 */
export function marketDataAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const f = readFlags(env);
  return f.marketPricesEnabled && (f.kalshiEnabled || f.polymarketEnabled);
}

/** Startup summary. Names and booleans only — never a credential. */
export function describeFlags(env: NodeJS.ProcessEnv = process.env): string {
  const f = readFlags(env);
  return Object.entries(f)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}
