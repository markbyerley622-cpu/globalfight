import type { RankingConnector } from "../connector";
import { RANKING_SOURCES } from "../sources";
import { wbaFemaleConnector } from "./wba";

// ════════════════════════════════════════════════════════════════════════
//  Connector registry — maps a source id to its implementation. A source can
//  only be INGESTED when all three hold:
//    1. the master flag RANKINGS_INGEST_ENABLED is on (checked by the caller),
//    2. the registry entry is `licensed: true` (owner cleared it), and
//    3. `connectorReady: true` AND a connector exists here.
//
//  BoxRec is never ingested — it is blocked here in code, independent of any
//  flag or registry edit, because its terms forbid bulk ingestion.
// ════════════════════════════════════════════════════════════════════════

/** Sources that must NEVER be ingested, whatever the registry says. */
export const INGEST_BLOCKLIST = new Set(["boxrec"]);

/** id → connector. Add a source by implementing RankingConnector and registering here. */
const CONNECTORS: Record<string, RankingConnector> = {
  "wba-female": wbaFemaleConnector,
  // Pending parsers (registered in sources.ts, connectorReady:false):
  //   wbc-female, wbo-female, ibf-female, ebu-* (PDF), boxing-ireland, ipba,
  //   fightersrec-pk, boxingscene.
  // NOTE: british-boxers is client-rendered (no server HTML, no data endpoint) —
  // it needs a headless fetch, so no plain connector is possible. See sources.ts.
};

/** The connectors the engine is currently cleared to run: licensed + ready + not blocked. */
export function ingestConnectors(): RankingConnector[] {
  return RANKING_SOURCES
    .filter((s) => s.licensed && s.connectorReady && !INGEST_BLOCKLIST.has(s.id))
    .map((s) => CONNECTORS[s.id])
    .filter((c): c is RankingConnector => Boolean(c));
}

/** All implemented connectors (for admin/status display), ignoring the gate. */
export function allConnectors(): RankingConnector[] {
  return Object.values(CONNECTORS);
}
