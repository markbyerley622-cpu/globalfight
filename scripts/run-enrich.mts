// Drive the licensed Wikimedia profile enrichment (photo + bio) over the whole
// pending queue, instead of one ENRICH_BATCH at a time.
//   MEDIA_INGESTION_ENABLED=true node --import tsx scripts/run-enrich.mts [rounds] [batch]
import { enrichPending } from "../src/lib/enrich/enrich.ts";
import { prisma } from "../src/lib/db.ts";

const rounds = Number(process.argv[2] ?? 12);
const batch = Number(process.argv[3] ?? 50);

let enriched = 0;
let photos = 0;
for (let i = 0; i < rounds; i++) {
  const r = await enrichPending(batch);
  enriched += r.enriched;
  photos += r.photos;
  console.log(`round ${i + 1}: scanned=${r.scanned} enriched=${r.enriched} photos=${r.photos}`);
  if (r.scanned === 0) break; // queue drained
}
console.log(`TOTAL enriched=${enriched} photos=${photos}`);
await prisma.$disconnect();
