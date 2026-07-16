// ════════════════════════════════════════════════════════════════════════
//  Fixtures provider — the last line of defence.
//
//  Serves realistic, already-normalized combat markets when BOTH live
//  providers fail AND the cache is cold (fresh deploy, upstream outage, or a
//  network that blocks the market APIs). The page therefore always renders real
//  UI — never a blank/error state. These are clearly labelled `fixtures` and
//  carry a synthetic probability history so the line graph still draws.
// ════════════════════════════════════════════════════════════════════════

import type {
  HistoryPoint,
  MarketHistory,
  PredictionMarket,
  PredictionProvider,
} from "@/features/predictions/types";

/** Deterministic pseudo-random walk toward `end`, so the graph looks alive
 *  without Math.random (which is banned in some runtimes and non-reproducible). */
function walk(seed: number, end: number, points = 48): HistoryPoint[] {
  const now = Math.floor(Date.now() / 1000);
  const step = 3600; // hourly
  let p = 0.5;
  const out: HistoryPoint[] = [];
  for (let i = points - 1; i >= 0; i--) {
    // Smooth deterministic wobble converging on the final probability.
    const wobble = Math.sin((i + seed) * 0.7) * 0.04;
    const drift = (end - p) * 0.12;
    p = Math.min(0.97, Math.max(0.03, p + drift + wobble));
    out.push({ t: now - i * step, p: +p.toFixed(4) });
  }
  out[out.length - 1].p = end; // land exactly on the current price
  return out;
}

type Seed = {
  id: string;
  title: string;
  description: string;
  sport: PredictionMarket["sport"];
  league: string | null;
  a: [string, number];
  b: [string, number];
  volume: number;
  volume24hr: number;
  liquidity: number;
  closesInDays: number;
  image: string | null;
};

const SEEDS: Seed[] = [
  {
    id: "saint-denis-pimblett",
    title: "Benoit Saint-Denis vs Paddy Pimblett",
    description: "UFC Lightweight — who wins?",
    sport: "MMA", league: "UFC",
    a: ["Benoit Saint-Denis", 0.57], b: ["Paddy Pimblett", 0.43],
    volume: 391000, volume24hr: 92000, liquidity: 21000, closesInDays: 4, image: null,
  },
  {
    id: "sandhagen-bautista",
    title: "Cory Sandhagen vs Mario Bautista",
    description: "UFC Bantamweight — who wins?",
    sport: "MMA", league: "UFC",
    a: ["Cory Sandhagen", 0.59], b: ["Mario Bautista", 0.41],
    volume: 81000, volume24hr: 28000, liquidity: 9000, closesInDays: 4, image: null,
  },
  {
    id: "mcgregor-2026",
    title: "Will Conor McGregor fight in 2026?",
    description: "Resolves Yes if McGregor competes in a sanctioned bout in 2026.",
    sport: "MMA", league: "UFC",
    a: ["Yes", 0.95], b: ["No", 0.05],
    volume: 23000, volume24hr: 2100, liquidity: 4300, closesInDays: 178, image: null,
  },
  {
    id: "canelo-benavidez",
    title: "Canelo Alvarez vs David Benavidez",
    description: "Super Middleweight — who wins if the fight is made?",
    sport: "Boxing", league: null,
    a: ["David Benavidez", 0.52], b: ["Canelo Alvarez", 0.48],
    volume: 64000, volume24hr: 15000, liquidity: 12000, closesInDays: 60, image: null,
  },
  {
    id: "paul-netflix-2026",
    title: "Will Jake Paul have another Netflix fight in 2026?",
    description: "Resolves Yes on an announced Netflix-broadcast Jake Paul bout in 2026.",
    sport: "Boxing", league: null,
    a: ["Yes", 0.63], b: ["No", 0.37],
    volume: 38000, volume24hr: 5400, liquidity: 7000, closesInDays: 178, image: null,
  },
  {
    id: "ksi-return",
    title: "Will KSI return to the ring in 2026?",
    description: "Resolves Yes if KSI competes in a Misfits/DAZN card in 2026.",
    sport: "Misfits", league: "Misfits",
    a: ["Yes", 0.44], b: ["No", 0.56],
    volume: 12000, volume24hr: 1800, liquidity: 3000, closesInDays: 120, image: null,
  },
];

function seedToMarket(s: Seed, now: number): PredictionMarket {
  const total = s.a[1] + s.b[1] || 1;
  const outcomes = [s.a, s.b].map(([label, p], i) => {
    const probability = p / total;
    return {
      id: `${i}`,
      label,
      probability,
      oddsDecimal: probability > 0 ? +(1 / probability).toFixed(2) : 0,
    };
  });
  return {
    id: `fixtures:${s.id}`,
    provider: "fixtures",
    title: s.title,
    description: s.description,
    sport: s.sport,
    league: s.league,
    category: "sample",
    status: "open",
    opensAt: new Date(now - 14 * 864e5).toISOString(),
    closesAt: new Date(now + s.closesInDays * 864e5).toISOString(),
    volume: s.volume,
    liquidity: s.liquidity,
    outcomes,
    image: s.image,
    featured: false,
    hot: false,
    sourceUrl: null,
    providerMetadata: { sample: true, volume24hr: s.volume24hr, favProb: outcomes[0].probability },
  };
}

export class FixturesProvider implements PredictionProvider {
  readonly id = "fixtures" as const;
  isEnabled(): boolean {
    return true; // always available — it's the safety net
  }

  async listMarkets(): Promise<PredictionMarket[]> {
    const now = Date.now();
    return SEEDS.map((s) => seedToMarket(s, now));
  }

  async getMarket(rawId: string): Promise<PredictionMarket | null> {
    const all = await this.listMarkets();
    return all.find((m) => m.id === `fixtures:${rawId}`) ?? null;
  }

  async getMarketHistory(rawId: string): Promise<MarketHistory | null> {
    const m = await this.getMarket(rawId);
    if (!m) return null;
    const seedNum = rawId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    return {
      marketId: m.id,
      provider: "fixtures",
      outcomeLabel: m.outcomes[0]?.label ?? "Yes",
      points: walk(seedNum, m.outcomes[0]?.probability ?? 0.5),
    };
  }
}
