// One-off runner for a scraper provider → canonical pipeline.
//   ENABLE_SCRAPER=true node --import tsx scripts/run-scraper.mts bkfc [maxPages]
// Fetches a harvest and persists events/fighters via the shared persistAggregated
// pipeline, gated by the ingestion registry. Prints a summary.
import { prisma } from "../src/lib/db.ts";
import { isSourceEnabled } from "../src/lib/ingestion-registry.ts";
import { persistAggregated } from "../src/services/sync/persist.ts";
import type { Sport } from "../src/lib/types.ts";

const provider = process.argv[2] ?? "bkfc";
const maxPages = Number(process.argv[3] ?? process.env.BKFC_MAX_PAGES ?? 0);
const entitiesArg = process.argv[4]?.split(",").filter(Boolean) as ("events" | "fighters")[] | undefined;

async function run() {
  if (provider === "bkfc") {
    const { syncBKFC } = await import("../src/lib/scraper/bkfc/index.ts");
    const h = await syncBKFC({ mode: "full", entities: entitiesArg ?? ["events", "fighters"], maxPages });
    console.log("BKFC harvest:", JSON.stringify(h.report.extracted), "warnings:", h.report.warnings.length);
    await persistBoth("BARE_KNUCKLE", "bkfc", h.fighters, h.events);
  } else if (provider === "one") {
    const { syncONE } = await import("../src/lib/scraper/one/index.ts");
    const h = await syncONE({ maxPages });
    console.log("ONE harvest:", JSON.stringify(h.report.extracted), "warnings:", h.report.warnings.length);
    if (isSourceEnabled("one-events")) {
      // ONE cards are mixed-sport — persist grouped by each event's own sport
      // (persistAggregated applies one sport per call).
      const bySport = new Map<string, typeof h.events>();
      for (const e of h.events) {
        const s = (e as { sport: string }).sport;
        if (!bySport.has(s)) bySport.set(s, []);
        bySport.get(s)!.push(e);
      }
      for (const [sport, evs] of bySport) {
        const n = await persistAggregated(sport as Sport, "events", evs as never);
        console.log(`one events [${sport}] written:`, n);
      }
    } else console.log("one-events DISABLED — skipped");
  } else if (provider === "adcc") {
    const { syncADCC } = await import("../src/lib/scraper/adcc/index.ts");
    const h = await syncADCC();
    console.log("ADCC harvest:", h.report.extracted, "events, warnings:", h.report.warnings.length);
    if (isSourceEnabled("adcc-events")) console.log("adcc events [BJJ] written:", await persistAggregated("BJJ", "events", h.events as never));
    else console.log("adcc-events DISABLED — skipped");
  } else {
    throw new Error(`unknown provider: ${provider}`);
  }
  await prisma.$disconnect();
}

async function persistBoth(sport: Sport, key: string, fighters: unknown[], events: unknown[]) {
  if (isSourceEnabled(`${key}-fighters`)) {
    const n = await persistAggregated(sport, "fighters", fighters as never);
    console.log(`${key} fighters written:`, n);
  } else console.log(`${key}-fighters DISABLED — skipped`);
  if (isSourceEnabled(`${key}-events`)) {
    const n = await persistAggregated(sport, "events", events as never);
    console.log(`${key} events written:`, n);
  } else console.log(`${key}-events DISABLED — skipped`);
}

run().catch((e) => {
  console.error("run failed:", e);
  process.exit(1);
});
